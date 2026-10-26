import { randomUUID } from "node:crypto";
import type { Queryable } from "../dto.js";
import type { Actor } from "../authMiddleware.js";
import { pool, withTransaction } from "../db.js";
import { ConflictError, DoNotContactError, NotFoundError, ValidationError } from "../errors.js";
import { dealRenderContext, getDealOr404, type DealRow } from "./deals.service.js";
import { getProposalOr404, getProposalRowOr404, updateProposalStatus, type ProposalRow } from "./proposals.service.js";
import { sendBlockReason } from "./consent.service.js";
import { addTimelineEvent, actorEvent } from "./timeline.service.js";
import { renderTemplate } from "../domain/templateRenderer.js";
import { htmlToWhatsAppText } from "../domain/htmlToWhatsAppText.js";
import { sendEmail } from "../providers/email.provider.js";
import { sendWhatsApp } from "../providers/whatsapp.provider.js";
import { ProviderDeferredError } from "../providers/provider-errors.js";
import { supabaseAdmin } from "../supabaseAdmin.js";

/**
 * Proposal documents and sending. Upload stores the file in the private crm-proposal-documents
 * bucket; send emails it now (the API can call the email provider) and queues WhatsApp for the
 * worker (the only process with Baileys sockets). Every send re-checks consent right before it goes.
 */

export const PROPOSAL_DOCUMENTS_BUCKET = "crm-proposal-documents";
const MAX_WHATSAPP_ATTEMPTS = 5;
const TERMINAL = ["accepted", "rejected", "withdrawn", "expired"];

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
  const template = (await db.query<TemplateRow>(`select * from crm_message_templates where id = $1 and workspace_id = $2`, [id, workspaceId])).rows[0];
  if (!template) throw new NotFoundError("Template");
  if (template.channel !== channel) throw new ValidationError(`Template "${template.name}" is not a ${channel} template.`);
  if (!template.is_active) throw new ValidationError(`Template "${template.name}" is inactive.`);
  return template;
}

export interface ProposalDocumentFile {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
}

/** Stores (or replaces) the proposal's document. A draft becomes "uploaded". */
export async function uploadProposalDocument(actor: Actor, workspaceId: string, proposalId: string, file: ProposalDocumentFile) {
  const proposal = await getProposalRowOr404(pool, workspaceId, proposalId);
  if (TERMINAL.includes(proposal.status)) throw new ConflictError(`Proposal is "${proposal.status}"; its document can no longer change.`);

  const storagePath = `${workspaceId}/${proposal.deal_id}/${randomUUID()}-${sanitizeFileName(file.originalName)}`;
  const { error } = await supabaseAdmin.storage.from(PROPOSAL_DOCUMENTS_BUCKET).upload(storagePath, file.buffer, { contentType: file.mimeType, upsert: false });
  if (error) throw new Error(`Failed to upload proposal document: ${error.message}`);

  await withTransaction(async (db) => {
    await db.query(
      `update crm_proposals set document_storage_path = $2, document_file_name = $3, document_mime_type = $4, document_size_bytes = $5 where id = $1`,
      [proposalId, storagePath, file.originalName, file.mimeType, file.size],
    );
    await addTimelineEvent(db, { dealId: proposal.deal_id, kind: "proposal", title: "Proposal Document Uploaded", detail: file.originalName, ...actorEvent(actor), relatedProposalId: proposalId });
    if (proposal.status === "draft") await updateProposalStatus(db, actor, workspaceId, proposalId, "uploaded");
  });
  if (proposal.document_storage_path) {
    await supabaseAdmin.storage.from(PROPOSAL_DOCUMENTS_BUCKET).remove([proposal.document_storage_path]).catch(() => undefined);
  }
  return getProposalOr404(pool, workspaceId, proposalId);
}

/** Once a channel has delivered, the proposal (and its deal) moves to "sent". */
async function tryAdvanceToSent(workspaceId: string, proposalId: string) {
  try {
    await withTransaction((db) => updateProposalStatus(db, null, workspaceId, proposalId, "sent"));
  } catch (err) {
    console.warn(`[proposalSending] Could not advance proposal ${proposalId} to "sent" after a successful send:`, err);
  }
}

async function sendProposalEmailNow(proposal: ProposalRow, deal: DealRow, template: TemplateRow): Promise<void> {
  try {
    const blocked = await sendBlockReason(pool, deal.contact_id, "email");
    if (blocked) throw new Error(blocked);
    const rendered = renderTemplate(template, dealRenderContext(deal));
    const { data, error } = await supabaseAdmin.storage.from(PROPOSAL_DOCUMENTS_BUCKET).download(proposal.document_storage_path!);
    if (error || !data) throw new Error(`Failed to download proposal document: ${error?.message ?? "no data"}`);
    const buffer = Buffer.from(await data.arrayBuffer());
    await sendEmail(proposal.workspace_id, {
      to: deal.email!,
      subject: rendered.subject?.trim() || template.name,
      html: rendered.body,
      attachments: [{ filename: proposal.document_file_name ?? "proposal", content: buffer.toString("base64") }],
    });
    await pool.query(`update crm_proposals set email_send_status = 'sent', email_sent_at = now(), email_send_error = null where id = $1`, [proposal.id]);
    await tryAdvanceToSent(proposal.workspace_id, proposal.id);
  } catch (err) {
    await pool.query(`update crm_proposals set email_send_status = 'failed', email_send_error = $2 where id = $1`, [proposal.id, err instanceof Error ? err.message : String(err)]);
  }
}

export interface SendProposalInput {
  emailTemplateId?: string;
  whatsappTemplateId?: string;
}

/**
 * Sends an uploaded proposal: email now, WhatsApp queued for the worker. A channel goes only if it
 * has a template and passes the consent check; a DNC contact gets 409.
 */
export async function sendProposal(actor: Actor, workspaceId: string, proposalId: string, input: SendProposalInput) {
  const proposal = await getProposalRowOr404(pool, workspaceId, proposalId);
  if (TERMINAL.includes(proposal.status)) throw new ConflictError(`Proposal is "${proposal.status}" and can no longer be sent.`);
  if (!proposal.document_storage_path) throw new ValidationError("Upload the proposal document before sending it.");
  const deal = await getDealOr404(pool, workspaceId, proposal.deal_id);
  if (deal.contact_status === "do_not_contact") throw new DoNotContactError();
  if (!input.emailTemplateId && !input.whatsappTemplateId) throw new ValidationError("Choose an email and/or a WhatsApp template.");

  const [emailTemplate] = await Promise.all([
    input.emailTemplateId ? getActiveTemplateOrThrow(pool, workspaceId, input.emailTemplateId, "email") : null,
    input.whatsappTemplateId ? getActiveTemplateOrThrow(pool, workspaceId, input.whatsappTemplateId, "whatsapp") : null,
  ]);
  const emailBlocked = input.emailTemplateId ? await sendBlockReason(pool, deal.contact_id, "email") : "No email template chosen.";
  const whatsappBlocked = input.whatsappTemplateId ? await sendBlockReason(pool, deal.contact_id, "whatsapp") : "No WhatsApp template chosen.";
  if (emailBlocked && whatsappBlocked) throw new ValidationError(`Nothing can be sent: ${emailBlocked} ${whatsappBlocked}`);

  await pool.query(
    `update crm_proposals
        set email_template_id = $2, whatsapp_template_id = $3,
            email_send_status = $4, email_send_error = $5,
            whatsapp_send_status = $6, whatsapp_send_error = $7, whatsapp_attempt_count = 0, whatsapp_next_attempt_at = null
      where id = $1`,
    [proposalId, input.emailTemplateId ?? null, input.whatsappTemplateId ?? null, emailBlocked ? "skipped" : "pending", emailBlocked, whatsappBlocked ? "skipped" : "queued", whatsappBlocked],
  );
  if (!emailBlocked && emailTemplate) await sendProposalEmailNow(await getProposalRowOr404(pool, workspaceId, proposalId), deal, emailTemplate);
  return getProposalOr404(pool, workspaceId, proposalId);
}

/** SKIP LOCKED claim of queued proposal WhatsApp sends (worker). */
export async function claimQueuedProposalWhatsappSends(db: Queryable, limit: number): Promise<ProposalRow[]> {
  const claimed = await db.query<ProposalRow>(
    `update crm_proposals
        set whatsapp_send_status = 'sending'
      where id in (
        select id from crm_proposals
         where whatsapp_send_status = 'queued'
           and (whatsapp_next_attempt_at is null or whatsapp_next_attempt_at <= now())
         order by created_at asc
         limit $1
         for update skip locked
      )
      returning *, null as owner_name, null as contact_name, null as company_name`,
    [limit],
  );
  return claimed.rows;
}

export async function processQueuedProposalWhatsappSend(row: ProposalRow): Promise<void> {
  const fail = (message: string) => pool.query(`update crm_proposals set whatsapp_send_status = 'failed', whatsapp_send_error = $2 where id = $1`, [row.id, message]);
  try {
    const deal = await getDealOr404(pool, row.workspace_id, row.deal_id);
    const blocked = await sendBlockReason(pool, deal.contact_id, "whatsapp");
    if (blocked) return void (await fail(blocked));
    if (!row.whatsapp_template_id || !row.document_storage_path) throw new Error("Queued WhatsApp proposal send is missing its template or document (invariant violation).");
    const template = await getActiveTemplateOrThrow(pool, row.workspace_id, row.whatsapp_template_id, "whatsapp");
    const rendered = renderTemplate(template, dealRenderContext(deal));
    await sendWhatsApp(row.workspace_id, {
      source: { type: "proposal", id: row.id },
      to: deal.phone_e164!,
      body: htmlToWhatsAppText(rendered.body),
      attachment: {
        storagePath: row.document_storage_path,
        fileName: row.document_file_name ?? "proposal",
        mimeType: row.document_mime_type ?? "application/octet-stream",
        bucket: PROPOSAL_DOCUMENTS_BUCKET,
      },
    });
    await pool.query(`update crm_proposals set whatsapp_send_status = 'sent', whatsapp_sent_at = now(), whatsapp_send_error = null where id = $1`, [row.id]);
    await tryAdvanceToSent(row.workspace_id, row.id);
  } catch (err) {
    if (err instanceof ProviderDeferredError) {
      const attempts = row.whatsapp_attempt_count + 1;
      if (attempts >= MAX_WHATSAPP_ATTEMPTS) return void (await fail(`Gave up after ${attempts} attempts: ${err.message}`));
      await pool.query(
        `update crm_proposals
            set whatsapp_send_status = 'queued', whatsapp_attempt_count = $2,
                whatsapp_next_attempt_at = now() + ($3 || ' milliseconds')::interval, whatsapp_send_error = $4
          where id = $1`,
        [row.id, attempts, String(err.retryAfterMs), err.message],
      );
      return;
    }
    await fail(err instanceof Error ? err.message : String(err));
  }
}
