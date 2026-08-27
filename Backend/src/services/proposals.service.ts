import type { Queryable } from "../dto.js";
import type { Actor } from "../authMiddleware.js";
import { NotFoundError, ValidationError } from "../errors.js";
import type { ProposalStatus } from "../domain/enums.js";
import { routeProposalStatus } from "../domain/proposalRouting.js";
import { addTimelineEvent, actorEvent } from "./timeline.service.js";
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
  amount: string | null;
  currency: string;
  status: ProposalStatus;
  sent_at: Date | null;
  follow_up_at: Date | null;
  next_action: string | null;
  notes: string | null;
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
    fileName: row.document_reference ?? undefined,
    amount: row.amount ? Number(row.amount) : undefined,
    currency: row.currency,
    status: row.status,
    sentDate: row.sent_at?.toISOString(),
    followUpDate: row.follow_up_at?.toISOString(),
    nextAction: row.next_action ?? undefined,
    notes: row.notes ?? undefined,
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
}

export async function createProposal(db: Queryable, actor: Actor, input: CreateProposalInput) {
  if (!input.title.trim()) throw new ValidationError("Proposal title is required.");
  const lead = await getLeadRowOr404(db, input.leadId);
  if (lead.lifecycle_state === "do_not_contact") throw new ValidationError("This lead is Do Not Contact.");

  const result = await db.query<{ id: string }>(
    `insert into public.proposals (lead_id, owner_id, title, document_reference, amount, status, notes, created_by, created_by_name)
     values ($1,$2,$3,$4,$5,'draft',$6,$7,$8) returning id`,
    [input.leadId, lead.owner_id, input.title.trim(), input.fileName ?? null, input.amount ?? null, input.notes ?? null, actor.id, actor.fullName],
  );
  const id = result.rows[0]!.id;

  await addTimelineEvent(db, { leadId: input.leadId, kind: "proposal", title: "Proposal Created", detail: input.title.trim(), ...actorEvent(actor) });
  await updateLead(db, actor, input.leadId, { pipelineStage: "proposal_preparation" });

  return getProposalOr404(db, id);
}

async function getProposalRowOr404(db: Queryable, id: string): Promise<ProposalRow> {
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
 * Proposal status routing (product brief, "PROPOSALS"). This IS the
 * business operation — a bare PATCH on `status` would skip the required
 * lead-state cascade (Rule 16), so status changes only ever go through
 * here.
 */
export async function updateProposalStatus(db: Queryable, actor: Actor, id: string, status: ProposalStatus) {
  const proposal = await getProposalRowOr404(db, id);
  if (proposal.status === status) return proposalToDto(proposal);

  const sets = ["status = $2"];
  const params: unknown[] = [id, status];
  let i = 3;
  if (status === "sent") {
    sets.push(`sent_at = now()`, `follow_up_at = $${i++}`);
    params.push(addDaysIso(3));
  }
  await db.query(`update public.proposals set ${sets.join(", ")} where id = $1`, params);

  await addTimelineEvent(db, { leadId: proposal.lead_id, kind: "proposal", title: `Proposal ${status}`, detail: proposal.title, ...actorEvent(actor), relatedProposalId: id });

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
