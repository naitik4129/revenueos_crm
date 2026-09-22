import { randomUUID } from "node:crypto";
import type { Queryable } from "../dto.js";
import type { Actor } from "../authMiddleware.js";
import { pool, withTransaction } from "../db.js";
import { DoNotContactError, NotFoundError, ValidationError } from "../errors.js";
import { getLeadRowOr404, type LeadRow } from "./leads.service.js";
import { createProposal, getProposalOr404, getProposalRowOr404, updateProposalStatus, type ProposalRow } from "./proposals.service.js";
import { renderTemplate, type TemplateRenderLead } from "../domain/templateRenderer.js";
import { htmlToWhatsAppText } from "../domain/htmlToWhatsAppText.js";
import { sendEmail } from "../providers/email.provider.js";
import { sendWhatsApp } from "../providers/whatsapp.provider.js";
import { ProviderDeferredError } from "../providers/provider-errors.js";
import { supabaseAdmin } from "../supabaseAdmin.js";

/**
 * Orchestrates the one-click "Send proposal" flow: create the proposal,
 * email it synchronously (the API process can call sendEmail directly — it
 * has no process affinity), and queue it for WhatsApp (which can only be
 * sent from the worker process — see baileysManager, the only process that
 * ever holds the live socket). worker.ts's poll loop drains the queue via
 * claimQueuedProposalWhatsappSends/processQueuedProposalWhatsappSend below.
 */

const PROPOSAL_DOCUMENTS_BUCKET = "proposal-documents";
const MAX_WHATSAPP_ATTEMPTS = 5;

function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150) || "file";
}

interface TemplateRow {
  id: string;
  name: string;
  channel: "email" | "whatsapp";
  subject: string | null;
  body: string;
  is_active: boolean;
}

async function getActiveTemplateOrThrow(db: Queryable, workspaceId: string, id: string, channel: "email" | "whatsapp"): Promise<TemplateRow> {
  const result = await db.query<TemplateRow>(`select * from public.message_templates where id = $1 and workspace_id = $2`, [id, workspaceId]);
  const template = result.rows[0];
  if (!template) throw new NotFoundError("Template");
  if (template.channel !== channel) throw new ValidationError(`Template "${template.name}" is not a ${channel} template.`);
  if (!template.is_active) throw new ValidationError(`Template "${template.name}" is inactive.`);
  return template;
}

function toRenderLead(lead: LeadRow & { owner_name?: string | null }): TemplateRenderLead {
  return {
    firstName: lead.first_name,
    lastName: lead.last_name,
    company: lead.company,
    industry: lead.industry,
    email: lead.email,
    phone: lead.phone,
    ownerName: lead.owner_name ?? null,
  };
}

/**
 * Advances the proposal's overall status to "sent" once a channel succeeds.
 * Idempotent (updateProposalStatus no-ops if already "sent") and, if the
 * proposal was independently moved to a terminal status in the meantime
 * (e.g. a human clicked Accepted/Rejected before this channel finished),
 * that race is logged and swallowed rather than turned into a false
 * "this channel failed to send" — the send already happened.
 */
async function tryAdvanceToSent(workspaceId: string, proposalId: string): Promise<void> {
  try {
    await withTransaction((client) => updateProposalStatus(client, null, workspaceId, proposalId, "sent"));
  } catch (err) {
    console.warn(`[proposalSending] Could not advance proposal ${proposalId} to "sent" after a successful channel send:`, err);
  }
}

async function sendProposalEmailNow(
  proposal: ProposalRow,
  lead: LeadRow & { owner_name?: string | null },
  template: TemplateRow,
): Promise<void> {
  try {
    if (!lead.email) throw new Error("Email-eligible send has no lead email (invariant violation).");
    if (!proposal.document_storage_path) throw new Error("Proposal has no uploaded document (invariant violation).");
    const rendered = renderTemplate(template, toRenderLead(lead));
    const { data, error } = await supabaseAdmin.storage.from(PROPOSAL_DOCUMENTS_BUCKET).download(proposal.document_storage_path);
    if (error || !data) throw new Error(`Failed to download proposal document: ${error?.message ?? "no data"}`);
    const buffer = Buffer.from(await data.arrayBuffer());
    const subject = rendered.subject?.trim() || template.name;
    await sendEmail(proposal.workspace_id, {
      to: lead.email,
      subject,
      html: rendered.body,
      attachments: [{ filename: proposal.document_file_name ?? "proposal", content: buffer.toString("base64") }],
    });
    await pool.query(
      `update public.proposals set email_send_status = 'sent', email_sent_at = now(), email_send_error = null where id = $1`,
      [proposal.id],
    );
    await tryAdvanceToSent(proposal.workspace_id, proposal.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await pool.query(`update public.proposals set email_send_status = 'failed', email_send_error = $2 where id = $1`, [proposal.id, message]);
  }
}

export interface CreateAndSendProposalInput {
  leadId: string;
  title: string;
  amount?: number;
  notes?: string;
  emailTemplateId: string;
  whatsappTemplateId: string;
}

export interface ProposalDocumentFile {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
}

export async function createAndSendProposal(actor: Actor, workspaceId: string, input: CreateAndSendProposalInput, file: ProposalDocumentFile) {
  if (!input.title.trim()) throw new ValidationError("Proposal title is required.");
  if (!input.emailTemplateId || !input.whatsappTemplateId) {
    throw new ValidationError("An email template and a WhatsApp template are both required.");
  }

  const lead = await getLeadRowOr404(pool, workspaceId, input.leadId);
  if (lead.lifecycle_state === "do_not_contact") throw new DoNotContactError();

  // Both validated up front so a bad selection fails fast; the WhatsApp
  // template is re-read fresh in processQueuedProposalWhatsappSend.
  const [emailTemplate] = await Promise.all([
    getActiveTemplateOrThrow(pool, workspaceId, input.emailTemplateId, "email"),
    getActiveTemplateOrThrow(pool, workspaceId, input.whatsappTemplateId, "whatsapp"),
  ]);

  const emailEligible = Boolean(lead.email);
  const whatsappEligible = Boolean(lead.phone_e164);
  if (!emailEligible && !whatsappEligible) {
    throw new ValidationError("This lead has no email address or WhatsApp-capable phone number - nothing to send.");
  }

  const storagePath = `${input.leadId}/${randomUUID()}-${sanitizeFileName(file.originalName)}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(PROPOSAL_DOCUMENTS_BUCKET)
    .upload(storagePath, file.buffer, { contentType: file.mimeType, upsert: false });
  if (uploadError) throw new Error(`Failed to upload proposal document: ${uploadError.message}`);

  const created = await withTransaction((client) =>
    createProposal(client, actor, workspaceId, {
      leadId: input.leadId,
      title: input.title,
      amount: input.amount,
      notes: input.notes,
      documentStoragePath: storagePath,
      documentFileName: file.originalName,
      documentMimeType: file.mimeType,
      documentSizeBytes: file.size,
      emailTemplateId: input.emailTemplateId,
      whatsappTemplateId: input.whatsappTemplateId,
      emailSendStatus: emailEligible ? "pending" : "skipped",
      whatsappSendStatus: whatsappEligible ? "queued" : "skipped",
    }),
  );

  if (emailEligible) {
    const proposalRow = await getProposalRowOr404(pool, workspaceId, created.id);
    await sendProposalEmailNow(proposalRow, lead, emailTemplate);
  }
  // WhatsApp (if eligible) is left "queued" — the worker's poll loop drains it.

  return getProposalOr404(pool, workspaceId, created.id);
}

/**
 * SKIP LOCKED claim, mirroring automation.service.ts's claimDueActions:
 * atomic so two worker poll ticks racing on the same rows never both claim
 * the same one.
 */
export async function claimQueuedProposalWhatsappSends(db: Queryable, limit: number): Promise<ProposalRow[]> {
  const claimed = await db.query<ProposalRow>(
    `update public.proposals
        set whatsapp_send_status = 'sending'
      where id in (
        select id from public.proposals
         where whatsapp_send_status = 'queued'
           and (whatsapp_next_attempt_at is null or whatsapp_next_attempt_at <= now())
         order by created_at asc
         limit $1
         for update skip locked
      )
      returning *`,
    [limit],
  );
  return claimed.rows;
}

export async function processQueuedProposalWhatsappSend(row: ProposalRow): Promise<void> {
  try {
    const lead = (await getLeadRowOr404(pool, row.workspace_id, row.lead_id)) as LeadRow & { owner_name: string | null };
    if (lead.lifecycle_state === "do_not_contact" || !lead.phone_e164) {
      await pool.query(`update public.proposals set whatsapp_send_status = 'failed', whatsapp_send_error = $2 where id = $1`, [
        row.id,
        lead.lifecycle_state === "do_not_contact" ? "Lead is now Do Not Contact." : "Lead no longer has a WhatsApp-capable phone number.",
      ]);
      return;
    }
    if (!row.whatsapp_template_id || !row.document_storage_path) {
      throw new Error("Queued WhatsApp proposal send is missing its template or document (invariant violation).");
    }
    const template = await getActiveTemplateOrThrow(pool, row.workspace_id, row.whatsapp_template_id, "whatsapp");
    const rendered = renderTemplate(template, toRenderLead(lead));
    const whatsappText = htmlToWhatsAppText(rendered.body);

    await sendWhatsApp(row.workspace_id, {
      source: { type: "proposal", id: row.id },
      to: lead.phone_e164,
      body: whatsappText,
      attachment: {
        storagePath: row.document_storage_path,
        fileName: row.document_file_name ?? "proposal",
        mimeType: row.document_mime_type ?? "application/octet-stream",
        bucket: PROPOSAL_DOCUMENTS_BUCKET,
      },
    });

    await pool.query(
      `update public.proposals set whatsapp_send_status = 'sent', whatsapp_sent_at = now(), whatsapp_send_error = null where id = $1`,
      [row.id],
    );
    await tryAdvanceToSent(row.workspace_id, row.id);
  } catch (err) {
    if (err instanceof ProviderDeferredError) {
      const attempts = row.whatsapp_attempt_count + 1;
      if (attempts >= MAX_WHATSAPP_ATTEMPTS) {
        await pool.query(
          `update public.proposals
              set whatsapp_send_status = 'failed', whatsapp_attempt_count = $2, whatsapp_send_error = $3
            where id = $1`,
          [row.id, attempts, `Gave up after ${attempts} attempts: ${err.message}`],
        );
        return;
      }
      await pool.query(
        `update public.proposals
            set whatsapp_send_status = 'queued', whatsapp_attempt_count = $2,
                whatsapp_next_attempt_at = now() + ($3 || ' milliseconds')::interval, whatsapp_send_error = $4
          where id = $1`,
        [row.id, attempts, String(err.retryAfterMs), err.message],
      );
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    await pool.query(`update public.proposals set whatsapp_send_status = 'failed', whatsapp_send_error = $2 where id = $1`, [row.id, message]);
  }
}
