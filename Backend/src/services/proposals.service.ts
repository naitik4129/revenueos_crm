import { pageSql, subjectNamesJoin, subjectNamesToDto, type Page, type Queryable, type SubjectNames } from "../dto.js";
import type { Actor } from "../authMiddleware.js";
import { ConflictError, DoNotContactError, NotFoundError, ValidationError } from "../errors.js";
import type { EmailSendStatus, LeadLossReason, ProposalStatus, WhatsappSendStatus } from "../domain/enums.js";
import { routeProposalStatus } from "../domain/proposalRouting.js";
import { addDaysIso } from "../dto.js";
import { userNameSql } from "./profiles.service.js";
import { addTimelineEvent, actorEvent, AUTOMATION_ACTOR } from "./timeline.service.js";
import { cancelOpenTasksForDeal, createTask } from "./tasks.service.js";
import { getDealOr404, markWon, moveToNurture, updateDeal } from "./deals.service.js";
import { autoEnroll } from "./runs.service.js";

export interface ProposalRow extends SubjectNames {
  id: string;
  workspace_id: string;
  deal_id: string;
  owner_id: string | null;
  owner_name: string | null;
  title: string;
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
  created_at: Date;
  updated_at: Date;
}

const PROPOSAL_SELECT = `select p.*, ${userNameSql("p.owner_id")} as owner_name, names.* from crm.proposals p ${subjectNamesJoin("p.deal_id")}`;

function proposalToDto(row: ProposalRow) {
  return {
    id: row.id,
    dealId: row.deal_id,
    ...subjectNamesToDto(row),
    ownerId: row.owner_id ?? undefined,
    ownerName: row.owner_name ?? undefined,
    title: row.title,
    fileName: row.document_file_name ?? undefined,
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
  dealId: string;
  title: string;
  amount?: number;
  currency?: string;
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

/** A draft proposal on an open deal; moves the deal to proposal_preparation. */
export async function createProposal(db: Queryable, actor: Actor, workspaceId: string, input: CreateProposalInput) {
  if (!input.title.trim()) throw new ValidationError("Proposal title is required.");
  const deal = await getDealOr404(db, workspaceId, input.dealId);
  if (deal.contact_status === "do_not_contact") throw new DoNotContactError();
  if (deal.outcome !== "open") throw new ConflictError(`Proposals can only be created on an open deal (this one is "${deal.outcome}").`);

  const id = (
    await db.query<{ id: string }>(
      `insert into crm.proposals
        (workspace_id, deal_id, owner_id, title, document_storage_path, document_file_name, document_mime_type,
         document_size_bytes, amount, currency, status, notes, email_template_id, whatsapp_template_id,
         email_send_status, whatsapp_send_status, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,coalesce($10, 'INR'),'draft',$11,$12,$13,$14,$15,$16) returning id`,
      [
        workspaceId,
        input.dealId,
        deal.owner_id,
        input.title.trim(),
        input.documentStoragePath ?? null,
        input.documentFileName ?? null,
        input.documentMimeType ?? null,
        input.documentSizeBytes ?? null,
        input.amount ?? null,
        input.currency ?? null,
        input.notes ?? null,
        input.emailTemplateId ?? null,
        input.whatsappTemplateId ?? null,
        input.emailSendStatus ?? "not_applicable",
        input.whatsappSendStatus ?? "not_applicable",
        actor.id,
      ],
    )
  ).rows[0]!.id;

  await addTimelineEvent(db, { dealId: input.dealId, kind: "proposal", title: "Proposal Created", detail: input.title.trim(), ...actorEvent(actor), relatedProposalId: id });
  await updateDeal(db, actor, workspaceId, input.dealId, { stage: "proposal_preparation" });
  return getProposalOr404(db, workspaceId, id);
}

export async function getProposalRowOr404(db: Queryable, workspaceId: string, id: string): Promise<ProposalRow> {
  const result = await db.query<ProposalRow>(`${PROPOSAL_SELECT} where p.id = $1 and p.workspace_id = $2`, [id, workspaceId]);
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Proposal");
  return row;
}

export async function getProposalOr404(db: Queryable, workspaceId: string, id: string) {
  return proposalToDto(await getProposalRowOr404(db, workspaceId, id));
}

export interface ListProposalsFilters {
  dealId?: string;
  status?: ProposalStatus;
  ownerId?: string;
}

/** The list's where clause; shared with the per-status counts so both see the same rows. */
function proposalWhere(params: unknown[], f: ListProposalsFilters) {
  const where = [`p.workspace_id = $1`];
  if (f.dealId) where.push(`p.deal_id = $${params.push(f.dealId)}`);
  if (f.status) where.push(`p.status = $${params.push(f.status)}`);
  if (f.ownerId) where.push(`p.owner_id = $${params.push(f.ownerId)}`);
  return where.join(" and ");
}

export async function listProposals(db: Queryable, workspaceId: string, f: ListProposalsFilters, page?: Page) {
  const params: unknown[] = [workspaceId];
  const result = await db.query<ProposalRow & { total: number }>(
    `select q.*, count(*) over()::int as total from (${PROPOSAL_SELECT} where ${proposalWhere(params, f)}) q
      order by q.updated_at desc, q.id ${pageSql(params, page)}`,
    params,
  );
  return { data: result.rows.map(proposalToDto), total: result.rows[0]?.total ?? 0 };
}

/** Proposals per status with the list's other filters (the status tabs' counts). */
export async function proposalStatusCounts(db: Queryable, workspaceId: string, f: ListProposalsFilters) {
  const { status: _ignored, ...others } = f;
  const params: unknown[] = [workspaceId];
  const result = await db.query<{ status: string; n: number }>(
    `select p.status, count(*)::int as n from crm.proposals p where ${proposalWhere(params, others)} group by p.status`,
    params,
  );
  return Object.fromEntries(result.rows.map((r) => [r.status, r.n])) as Record<string, number>;
}

/**
 * The Proposals page stat cards, for the whole workspace (the list is paged). Open = not yet
 * terminal; value in play = amounts of proposals out with the client (sent / revision requested / revised).
 */
export async function proposalsSummary(db: Queryable, workspaceId: string) {
  const row = (
    await db.query<{ open: number; awaiting_decision: number; value_in_play: string }>(
      `select count(*) filter (where status not in ('accepted', 'rejected', 'withdrawn', 'expired'))::int as open,
              count(*) filter (where status = 'sent')::int as awaiting_decision,
              coalesce(sum(amount) filter (where status in ('sent', 'revision_requested', 'revised')), 0) as value_in_play
         from crm.proposals where workspace_id = $1`,
      [workspaceId],
    )
  ).rows[0]!;
  return { open: row.open, awaitingDecision: row.awaiting_decision, valueInPlay: Number(row.value_in_play) };
}

export interface UpdateProposalInput {
  title?: string;
  amount?: number;
  notes?: string;
}

/** Plain field edits; status changes go through updateProposalStatus (routing). */
export async function updateProposal(db: Queryable, workspaceId: string, id: string, patch: UpdateProposalInput) {
  await getProposalRowOr404(db, workspaceId, id);
  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, value: unknown) => sets.push(`${col} = $${params.push(value)}`);
  if (patch.title !== undefined) {
    if (!patch.title.trim()) throw new ValidationError("Proposal title is required.");
    set("title", patch.title.trim());
  }
  if (patch.amount !== undefined) set("amount", patch.amount);
  if (patch.notes !== undefined) set("notes", patch.notes);
  if (sets.length > 0) await db.query(`update crm.proposals set ${sets.join(", ")} where id = $${params.push(id)}`, params);
  return getProposalOr404(db, workspaceId, id);
}

/**
 * Terminal statuses: their routing already changed the deal (accepted -> won,
 * rejected/expired -> nurture) or ended the proposal (withdrawn). Those effects are one-way,
 * so moving back out is blocked.
 */
const TERMINAL_PROPOSAL_STATUSES: ProposalStatus[] = ["accepted", "rejected", "withdrawn", "expired"];

export interface UpdateProposalStatusOptions {
  /** Required for rejected/expired (proposals_loss_has_reason enforces it too). */
  lossReason?: LeadLossReason;
  lossNotes?: string;
}

/** Proposal status routing (CONTEXT.md, "Proposal routing"). The only way to change a status. */
export async function updateProposalStatus(
  db: Queryable,
  actor: Actor | null,
  workspaceId: string,
  id: string,
  status: ProposalStatus,
  options: UpdateProposalStatusOptions = {},
) {
  const proposal = await getProposalRowOr404(db, workspaceId, id);
  if (proposal.status === status) return proposalToDto(proposal);
  if (TERMINAL_PROPOSAL_STATUSES.includes(proposal.status)) {
    throw new ConflictError(`Proposal is already "${proposal.status}", a terminal status - it can't be moved to "${status}". Create a new proposal instead.`);
  }
  if ((status === "rejected" || status === "expired") && !options.lossReason) {
    throw new ValidationError(`lossReason is required when moving a proposal to "${status}".`, { field: "lossReason" });
  }

  const sets = ["status = $2"];
  const params: unknown[] = [id, status];
  if (status === "sent") sets.push(`sent_at = now()`, `follow_up_at = $${params.push(addDaysIso(3))}`);
  if (status === "rejected" || status === "expired") {
    sets.push(`loss_reason = $${params.push(options.lossReason)}`, `loss_notes = $${params.push(options.lossNotes?.trim() || null)}`);
  }
  await db.query(`update crm.proposals set ${sets.join(", ")} where id = $1`, params);
  await addTimelineEvent(db, {
    dealId: proposal.deal_id,
    kind: "proposal",
    title: `Proposal ${status}`,
    detail: proposal.title,
    ...(actor ? actorEvent(actor) : AUTOMATION_ACTOR),
    relatedProposalId: id,
  });

  const routing = routeProposalStatus(status);
  // Stage first: it can only change while the deal is still open.
  if (routing.stage) await updateDeal(db, actor, workspaceId, proposal.deal_id, { stage: routing.stage });
  if (routing.cancelOpenProposalFollowUps) {
    await cancelOpenTasksForDeal(db, actor, proposal.deal_id, `Superseded - proposal ${status}`, ["proposal_follow_up"]);
  }
  // accepted -> won: the 009 trigger cancels all open tasks (routing.cancelAllOpenTasks).
  if (routing.outcome === "won") await markWon(db, actor, workspaceId, proposal.deal_id, `Proposal accepted: ${proposal.title}`);
  if (routing.outcome === "nurture") await moveToNurture(db, actor, workspaceId, proposal.deal_id, `Proposal ${status}: ${proposal.title}`);
  if (routing.task) {
    await createTask(db, actor, workspaceId, {
      dealId: proposal.deal_id,
      ownerId: proposal.owner_id,
      type: routing.task.type,
      title: routing.task.title,
      dueAt: addDaysIso(routing.task.dueInDays),
    });
  }
  if (routing.workflowTrigger) {
    await autoEnroll(db, workspaceId, proposal.deal_id, routing.workflowTrigger, `Proposal ${status}: ${proposal.title}`);
  }
  return getProposalOr404(db, workspaceId, id);
}
