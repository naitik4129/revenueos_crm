import type { Queryable } from "../dto.js";
import type { Actor } from "../authMiddleware.js";
import { ConflictError, DoNotContactError, NotFoundError, ValidationError } from "../errors.js";
import type { EmailSendStatus, LeadLossReason, ProposalStatus, WhatsappSendStatus } from "../domain/enums.js";
import { routeProposalStatus } from "../domain/proposalRouting.js";
import { addTimelineEvent, actorEvent, AUTOMATION_ACTOR } from "./timeline.service.js";
import { cancelOpenTasksForLead, createTask } from "./tasks.service.js";
import { getLeadRowOr404, markWon, moveToLongTermNurture, updateLead } from "./leads.service.js";
import { autoEnroll } from "./runs.service.js";
import { addDaysIso } from "../dto.js";

export interface ProposalRow {
  id: string;
  lead_id: string;
  owner_id: string | null;
  owner_name: string | null;
  title: string;
  document_reference: string | null;
  document_storage_path: string | null;
  document_file_name: string | null;
  document_mime_type: string | null;
  document_size_bytes: number | null;
  amount: string | null;
  currency: string;
  status: ProposalStatus;
  sent_at: Date | null;
  follow_up_at: Date | null;
  next_action: string | null;
  notes: string | null;
  email_template_id: string | null;
  whatsapp_template_id: string | null;
  email_send_status: EmailSendStatus;
  email_sent_at: Date | null;
  email_send_error: string | null;
  whatsapp_send_status: WhatsappSendStatus;
  whatsapp_sent_at: Date | null;
  whatsapp_send_error: string | null;
  whatsapp_next_attempt_at: Date | null;
  whatsapp_attempt_count: number;
  loss_reason: LeadLossReason | null;
  loss_notes: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: Date;
  updated_at: Date;
}

function proposalToDto(row: ProposalRow) {
  return {
    id: row.id,
    leadId: row.lead_id,
    ownerId: row.owner_id ?? undefined,
    ownerName: row.owner_name ?? undefined,
    title: row.title,
    fileName: row.document_file_name ?? row.document_reference ?? undefined,
    documentMimeType: row.document_mime_type ?? undefined,
    documentSizeBytes: row.document_size_bytes ?? undefined,
    amount: row.amount ? Number(row.amount) : undefined,
    currency: row.currency,
    status: row.status,
    sentDate: row.sent_at?.toISOString(),
    followUpDate: row.follow_up_at?.toISOString(),
    nextAction: row.next_action ?? undefined,
    notes: row.notes ?? undefined,
    emailTemplateId: row.email_template_id ?? undefined,
    whatsappTemplateId: row.whatsapp_template_id ?? undefined,
    emailSendStatus: row.email_send_status,
    emailSentAt: row.email_sent_at?.toISOString(),
    emailSendError: row.email_send_error ?? undefined,
    whatsappSendStatus: row.whatsapp_send_status,
    whatsappSentAt: row.whatsapp_sent_at?.toISOString(),
    whatsappSendError: row.whatsapp_send_error ?? undefined,
    lossReason: row.loss_reason ?? undefined,
    lossNotes: row.loss_notes ?? undefined,
    updatedAt: row.updated_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

export interface CreateProposalInput {
  leadId: string;
  title: string;
  fileName?: string;
  amount?: number;
  notes?: string;
  documentStoragePath?: string;
  documentFileName?: string;
  documentMimeType?: string;
  documentSizeBytes?: number;
  emailTemplateId?: string;
  whatsappTemplateId?: string;
  emailSendStatus?: EmailSendStatus;
  whatsappSendStatus?: WhatsappSendStatus;
}

export async function createProposal(db: Queryable, actor: Actor, input: CreateProposalInput) {
  if (!input.title.trim()) throw new ValidationError("Proposal title is required.");
  const lead = await getLeadRowOr404(db, input.leadId);
  if (lead.lifecycle_state === "do_not_contact") throw new DoNotContactError();

  const result = await db.query<{ id: string }>(
    `insert into public.proposals
      (lead_id, owner_id, title, document_reference, document_storage_path, document_file_name,
       document_mime_type, document_size_bytes, amount, status, notes,
       email_template_id, whatsapp_template_id, email_send_status, whatsapp_send_status,
       created_by, created_by_name)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10,$11,$12,$13,$14,$15,$16) returning id`,
    [
      input.leadId,
      lead.owner_id,
      input.title.trim(),
      input.fileName ?? null,
      input.documentStoragePath ?? null,
      input.documentFileName ?? null,
      input.documentMimeType ?? null,
      input.documentSizeBytes ?? null,
      input.amount ?? null,
      input.notes ?? null,
      input.emailTemplateId ?? null,
      input.whatsappTemplateId ?? null,
      input.emailSendStatus ?? "not_applicable",
      input.whatsappSendStatus ?? "not_applicable",
      actor.id,
      actor.fullName,
    ],
  );
  const id = result.rows[0]!.id;

  await addTimelineEvent(db, { leadId: input.leadId, kind: "proposal", title: "Proposal Created", detail: input.title.trim(), ...actorEvent(actor) });
  await updateLead(db, actor, input.leadId, { pipelineStage: "proposal_preparation" });

  return getProposalOr404(db, id);
}

export async function getProposalRowOr404(db: Queryable, id: string): Promise<ProposalRow> {
  const result = await db.query<ProposalRow>(`select * from public.proposals where id = $1`, [id]);
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Proposal");
  return row;
}

export async function getProposalOr404(db: Queryable, id: string) {
  return proposalToDto(await getProposalRowOr404(db, id));
}

export interface ListProposalsFilters {
  leadId?: string;
  status?: ProposalStatus;
  ownerId?: string;
}

export async function listProposals(db: Queryable, filters: ListProposalsFilters) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (filters.leadId) {
    clauses.push(`lead_id = $${i++}`);
    params.push(filters.leadId);
  }
  if (filters.status) {
    clauses.push(`status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.ownerId) {
    clauses.push(`owner_id = $${i++}`);
    params.push(filters.ownerId);
  }
  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  const result = await db.query<ProposalRow>(`select * from public.proposals ${where} order by updated_at desc`, params);
  return result.rows.map(proposalToDto);
}

export interface UpdateProposalInput {
  title?: string;
  fileName?: string;
  amount?: number;
  notes?: string;
}

/** Plain field edits — use updateProposalStatus for status transitions (outcome routing). */
export async function updateProposal(db: Queryable, id: string, patch: UpdateProposalInput) {
  await getProposalRowOr404(db, id);
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  const push = (col: string, value: unknown) => {
    sets.push(`${col} = $${i++}`);
    params.push(value);
  };
  if (patch.title !== undefined) push("title", patch.title.trim());
  if (patch.fileName !== undefined) push("document_reference", patch.fileName || null);
  if (patch.amount !== undefined) push("amount", patch.amount);
  if (patch.notes !== undefined) push("notes", patch.notes);
  if (sets.length === 0) return getProposalOr404(db, id);
  params.push(id);
  await db.query(`update public.proposals set ${sets.join(", ")} where id = $${i}`, params);
  return getProposalOr404(db, id);
}

/**
 * Terminal proposal statuses: their routing already moved the lead's
 * lifecycle (accepted -> won, rejected/expired -> long_term_nurture) or
 * ended the deal (withdrawn). Their side effects (cancelling tasks,
 * enrolling workflows, changing lifecycle) are one-way — re-running them by
 * transitioning back out is not a safe "undo", so it's blocked below.
 */
const TERMINAL_PROPOSAL_STATUSES: ProposalStatus[] = ["accepted", "rejected", "withdrawn", "expired"];

/**
 * Proposal status routing (product brief, "PROPOSALS"). This IS the
 * business operation — a bare PATCH on `status` would skip the required
 * lead-state cascade (Rule 16), so status changes only ever go through
 * here.
 */
export interface UpdateProposalStatusOptions {
  /** Required for rejected/expired (proposals_loss_has_reason enforces this at the DB level too). */
  lossReason?: LeadLossReason;
  lossNotes?: string;
}

export async function updateProposalStatus(
  db: Queryable,
  actor: Actor | null,
  id: string,
  status: ProposalStatus,
  options: UpdateProposalStatusOptions = {},
) {
  const proposal = await getProposalRowOr404(db, id);
  if (proposal.status === status) return proposalToDto(proposal);
  if (TERMINAL_PROPOSAL_STATUSES.includes(proposal.status)) {
    throw new ConflictError(
      `Proposal is already "${proposal.status}", a terminal status — it can't be moved to "${status}". Create a new proposal instead.`,
    );
  }
  if ((status === "rejected" || status === "expired") && !options.lossReason) {
    throw new ValidationError(`lossReason is required when moving a proposal to "${status}".`);
  }

  const sets = ["status = $2"];
  const params: unknown[] = [id, status];
  let i = 3;
  if (status === "sent") {
    sets.push(`sent_at = now()`, `follow_up_at = $${i++}`);
    params.push(addDaysIso(3));
  }
  if (status === "rejected" || status === "expired") {
    sets.push(`loss_reason = $${i++}`, `loss_notes = $${i++}`);
    params.push(options.lossReason, options.lossNotes?.trim() || null);
  }
  await db.query(`update public.proposals set ${sets.join(", ")} where id = $1`, params);

  await addTimelineEvent(db, { leadId: proposal.lead_id, kind: "proposal", title: `Proposal ${status}`, detail: proposal.title, ...(actor ? actorEvent(actor) : AUTOMATION_ACTOR), relatedProposalId: id });

  const routing = routeProposalStatus(status);

  if (routing.lifecycle === "won") {
    await markWon(db, actor, proposal.lead_id, `Proposal accepted: ${proposal.title}`);
  } else if (routing.lifecycle === "long_term_nurture") {
    await moveToLongTermNurture(db, actor, proposal.lead_id, `Proposal ${status}: ${proposal.title}`);
  }

  if (routing.stage) {
    await updateLead(db, actor, proposal.lead_id, { pipelineStage: routing.stage });
  }

  if (routing.cancelAllOpenTasks) {
    await cancelOpenTasksForLead(db, actor, proposal.lead_id, "Lead Won");
  } else if (routing.cancelOpenProposalFollowUps) {
    await cancelOpenTasksForLead(db, actor, proposal.lead_id, `Superseded — proposal ${status}`, ["proposal_follow_up"]);
  }

  if (routing.task) {
    await createTask(db, actor, {
      leadId: proposal.lead_id,
      ownerId: proposal.owner_id,
      type: routing.task.type,
      title: routing.task.title,
      dueAt: addDaysIso(routing.task.dueInDays),
      origin: "manual",
    });
  }

  if (routing.workflowTrigger) {
    await autoEnroll(db, proposal.lead_id, routing.workflowTrigger, `Proposal ${status}: ${proposal.title}`);
  }

  return getProposalOr404(db, id);
}
