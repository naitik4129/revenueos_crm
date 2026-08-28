import type { Queryable } from "../dto.js";
import type { Actor } from "../authMiddleware.js";
import { ConflictError, DoNotContactError, NotFoundError, ValidationError } from "../errors.js";
import { assertPipelineStageEditable, assertValidLifecycleState, assertValidPipelineStage, isTerminalLifecycle } from "../domain/pipeline.js";
import type { AutomationMode, ContactChannel, LeadSource, LifecycleState, PipelineStage, ResponseState } from "../domain/enums.js";
import { CONTACT_CHANNEL_STATUS } from "../domain/enums.js";
import { addTimelineEvent, actorEvent } from "./timeline.service.js";
import { cancelOpenTasksForLead, getLeadNextAction } from "./tasks.service.js";
import { applyAutomationModeToRuns } from "./runs.service.js";

export interface LeadRow {
  id: string;
  first_name: string;
  last_name: string;
  company: string;
  job_title: string | null;
  industry: string | null;
  email: string | null;
  phone: string | null;
  source: LeadSource;
  service_interest: string | null;
  owner_id: string | null;
  owner_name: string | null;
  pipeline_stage: PipelineStage;
  lifecycle_state: LifecycleState;
  automation_mode: AutomationMode;
  response_state: ResponseState;
  dnc_reason: string | null;
  dnc_by: string | null;
  dnc_by_name: string | null;
  dnc_at: Date | null;
  merged_into_lead_id: string | null;
  last_activity_at: Date;
  created_by: string | null;
  created_by_name: string | null;
  created_at: Date;
  updated_at: Date;
}

const LEAD_SELECT = `
  select l.*, o.full_name as owner_name
  from public.leads l
  left join public.profiles o on o.id = l.owner_id
`;

export function leadToDto(row: LeadRow, nextAction?: Awaited<ReturnType<typeof getLeadNextAction>>) {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    company: row.company,
    jobTitle: row.job_title ?? "",
    industry: row.industry ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    source: row.source,
    serviceInterest: row.service_interest ?? "",
    ownerId: row.owner_id ?? undefined,
    ownerName: row.owner_name ?? undefined,
    pipelineStage: row.pipeline_stage,
    lifecycleState: row.lifecycle_state,
    automationMode: row.automation_mode,
    responseState: row.response_state,
    doNotContact: row.lifecycle_state === "do_not_contact",
    dncReason: row.dnc_reason ?? undefined,
    dncBy: row.dnc_by_name ?? undefined,
    dncAt: row.dnc_at?.toISOString(),
    mergedIntoLeadId: row.merged_into_lead_id ?? undefined,
    lastActivityAt: row.last_activity_at.toISOString(),
    createdBy: row.created_by_name ?? undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    nextAction: nextAction ?? null,
  };
}

export interface CreateLeadInput {
  firstName: string;
  lastName?: string;
  company: string;
  jobTitle?: string;
  industry?: string;
  email?: string;
  phone?: string;
  source: LeadSource;
  serviceInterest?: string;
  ownerId?: string;
}

export async function createLead(db: Queryable, actor: Actor, input: CreateLeadInput): Promise<LeadRow> {
  if (!input.firstName.trim()) throw new ValidationError("First name is required.");
  if (!input.company.trim()) throw new ValidationError("Company is required.");
  if (!input.email?.trim() && !input.phone?.trim()) {
    throw new ValidationError("Provide at least an email or a phone number.");
  }

  const ownerId = input.ownerId ?? actor.id;
  const result = await db.query<{ id: string }>(
    `insert into public.leads
      (first_name, last_name, company, job_title, industry, email, phone, source,
       service_interest, owner_id, created_by, created_by_name)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     returning id`,
    [
      input.firstName.trim(),
      input.lastName?.trim() ?? "",
      input.company.trim(),
      input.jobTitle?.trim() ?? null,
      input.industry?.trim() ?? null,
      input.email?.trim() ?? null,
      input.phone?.trim() ?? null,
      input.source,
      input.serviceInterest?.trim() ?? null,
      ownerId,
      actor.id,
      actor.fullName,
    ],
  );
  const id = result.rows[0]!.id;

  const owner = await db.query<{ full_name: string }>(`select full_name from public.profiles where id = $1`, [ownerId]);
  const ownerName = owner.rows[0]?.full_name ?? "Unassigned";

  await addTimelineEvent(db, {
    leadId: id,
    kind: "system",
    title: "Lead Created",
    detail: `Source: ${input.source}`,
    ...actorEvent(actor),
  });
  await addTimelineEvent(db, {
    leadId: id,
    kind: "system",
    title: "Lead Assigned",
    detail: `Owner: ${ownerName}`,
    ...actorEvent(actor),
  });

  return getLeadRowOr404(db, id);
}

export async function getLeadRowOr404(db: Queryable, id: string): Promise<LeadRow> {
  const result = await db.query<LeadRow>(`${LEAD_SELECT} where l.id = $1`, [id]);
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Lead");
  return row;
}

export interface ListLeadsFilters {
  stage?: PipelineStage;
  lifecycle?: LifecycleState;
  ownerId?: string;
  source?: LeadSource;
  automationMode?: AutomationMode;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listLeads(db: Queryable, filters: ListLeadsFilters) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (filters.stage) {
    clauses.push(`l.pipeline_stage = $${i++}`);
    params.push(filters.stage);
  }
  if (filters.lifecycle) {
    clauses.push(`l.lifecycle_state = $${i++}`);
    params.push(filters.lifecycle);
  }
  if (filters.ownerId) {
    clauses.push(`l.owner_id = $${i++}`);
    params.push(filters.ownerId);
  }
  if (filters.source) {
    clauses.push(`l.source = $${i++}`);
    params.push(filters.source);
  }
  if (filters.automationMode) {
    clauses.push(`l.automation_mode = $${i++}`);
    params.push(filters.automationMode);
  }
  if (filters.search) {
    clauses.push(
      `(l.first_name ilike $${i} or l.last_name ilike $${i} or l.company ilike $${i} or l.email ilike $${i} or l.phone ilike $${i})`,
    );
    params.push(`%${filters.search}%`);
    i++;
  }

  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  const limit = Math.min(filters.limit ?? 200, 500);
  const offset = filters.offset ?? 0;
  params.push(limit, offset);

  const result = await db.query<LeadRow>(
    `${LEAD_SELECT} ${where} order by l.created_at desc limit $${i++} offset $${i++}`,
    params,
  );

  // Batch-load next actions for the page rather than N+1 querying per lead.
  const ids = result.rows.map((r) => r.id);
  const nextActions = new Map<string, Awaited<ReturnType<typeof getLeadNextAction>>>();
  if (ids.length > 0) {
    const naResult = await db.query<{
      lead_id: string;
      task_id: string;
      task_type: string;
      title: string;
      due_at: Date;
      owner_id: string | null;
      owner_name: string | null;
      origin: string;
    }>(`select * from public.lead_next_actions where lead_id = any($1::uuid[])`, [ids]);
    for (const row of naResult.rows) {
      nextActions.set(row.lead_id, {
        taskId: row.task_id,
        type: row.task_type as never,
        title: row.title,
        dueAt: row.due_at.toISOString(),
        ownerId: row.owner_id ?? undefined,
        ownerName: row.owner_name ?? undefined,
        origin: row.origin as never,
      });
    }
  }

  return result.rows.map((row) => leadToDto(row, nextActions.get(row.id) ?? null));
}

export interface UpdateLeadInput {
  firstName?: string;
  lastName?: string;
  company?: string;
  jobTitle?: string;
  industry?: string;
  email?: string;
  phone?: string;
  source?: LeadSource;
  serviceInterest?: string;
  ownerId?: string;
  pipelineStage?: PipelineStage;
  responseState?: ResponseState;
}

/**
 * Generic field editor. Deliberately does NOT accept lifecycleState,
 * automationMode or DNC/merge fields — those go through dedicated
 * endpoints (setAutomationMode, markDnc, reactivateLead, mergeLead, ...)
 * because they carry side effects (workflow cancellation, task cleanup,
 * audit trail entries) that a bare field patch must not silently skip.
 */
export async function updateLead(
  db: Queryable,
  actor: Actor,
  id: string,
  patch: UpdateLeadInput,
): Promise<LeadRow> {
  const current = await getLeadRowOr404(db, id);

  if (patch.pipelineStage) {
    assertValidPipelineStage(patch.pipelineStage);
    assertPipelineStageEditable(current.lifecycle_state);
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  const push = (col: string, value: unknown) => {
    sets.push(`${col} = $${i++}`);
    params.push(value);
  };

  if (patch.firstName !== undefined) push("first_name", patch.firstName.trim());
  if (patch.lastName !== undefined) push("last_name", patch.lastName.trim());
  if (patch.company !== undefined) push("company", patch.company.trim());
  if (patch.jobTitle !== undefined) push("job_title", patch.jobTitle.trim() || null);
  if (patch.industry !== undefined) push("industry", patch.industry.trim() || null);
  if (patch.email !== undefined) push("email", patch.email.trim() || null);
  if (patch.phone !== undefined) push("phone", patch.phone.trim() || null);
  if (patch.source !== undefined) push("source", patch.source);
  if (patch.serviceInterest !== undefined) push("service_interest", patch.serviceInterest.trim() || null);
  if (patch.ownerId !== undefined) push("owner_id", patch.ownerId);
  if (patch.pipelineStage !== undefined) push("pipeline_stage", patch.pipelineStage);
  if (patch.responseState !== undefined) push("response_state", patch.responseState);

  if (sets.length === 0) return current;

  sets.push(`last_activity_at = now()`);
  params.push(id);
  await db.query(`update public.leads set ${sets.join(", ")} where id = $${i}`, params);

  if (patch.pipelineStage && patch.pipelineStage !== current.pipeline_stage) {
    await addTimelineEvent(db, {
      leadId: id,
      kind: "stage",
      title: `Stage changed to ${patch.pipelineStage}`,
      ...actorEvent(actor),
    });
  }
  if (patch.ownerId && patch.ownerId !== current.owner_id) {
    const owner = await db.query<{ full_name: string }>(`select full_name from public.profiles where id = $1`, [patch.ownerId]);
    await addTimelineEvent(db, {
      leadId: id,
      kind: "system",
      title: "Lead Assigned",
      detail: `Owner: ${owner.rows[0]?.full_name ?? "Unassigned"}`,
      ...actorEvent(actor),
    });
  }

  return getLeadRowOr404(db, id);
}

export async function addNote(db: Queryable, actor: Actor, leadId: string, body: string) {
  if (!body.trim()) throw new ValidationError("Note body is required.");
  await getLeadRowOr404(db, leadId);

  const result = await db.query<{ id: string; created_at: Date }>(
    `insert into public.lead_notes (lead_id, author_id, author_name, body)
     values ($1,$2,$3,$4) returning id, created_at`,
    [leadId, actor.id, actor.fullName, body.trim()],
  );
  await db.query(`update public.leads set last_activity_at = now() where id = $1`, [leadId]);
  await addTimelineEvent(db, {
    leadId,
    kind: "note",
    title: "Note Added",
    detail: body.trim(),
    ...actorEvent(actor),
  });
  return { id: result.rows[0]!.id, author: actor.fullName, at: result.rows[0]!.created_at.toISOString(), body: body.trim() };
}

export async function listNotes(db: Queryable, leadId: string) {
  const result = await db.query<{ id: string; author_name: string; body: string; created_at: Date }>(
    `select id, author_name, body, created_at from public.lead_notes where lead_id = $1 order by created_at desc`,
    [leadId],
  );
  return result.rows.map((r) => ({ id: r.id, author: r.author_name, body: r.body, at: r.created_at.toISOString() }));
}

/**
 * Sets the lead-wide automation switch and cascades to in-flight workflow
 * runs (Rule 9: paused/manual automation must actually prevent
 * inappropriate customer-facing actions; Rule 10: resume must not blast
 * obsolete missed messages — see runs.service.applyAutomationModeToRuns).
 */
export async function setAutomationMode(
  db: Queryable,
  actor: Actor,
  leadId: string,
  mode: AutomationMode,
  reason?: string,
) {
  const current = await getLeadRowOr404(db, leadId);
  if (isTerminalLifecycle(current.lifecycle_state)) {
    throw new ConflictError(
      `Cannot change automation mode: lead lifecycle is "${current.lifecycle_state}" (automation stays stopped).`,
    );
  }

  await db.query(`update public.leads set automation_mode = $2, last_activity_at = now() where id = $1`, [leadId, mode]);

  const title =
    mode === "active" ? "Automation Resumed" : mode === "paused" ? "Automation Paused" : mode === "stopped" ? "Automation Stopped" : "Switched to Manual";
  await addTimelineEvent(db, { leadId, kind: "automation", title, detail: reason, ...actorEvent(actor) });

  await applyAutomationModeToRuns(db, leadId, mode, reason ?? `Lead automation set to ${mode}`);

  return getLeadRowOr404(db, leadId);
}

export interface MarkDncInput {
  reason: string;
}

/**
 * DNC override (Rule 6). lifecycle_state -> do_not_contact triggers the DB
 * cascade (leads_cascade_lifecycle_change): cancels in-flight
 * workflow_runs/scheduled_actions and writes a dnc_events row. We
 * additionally clear open tasks here (the DB cascade only touches
 * automation, not manual tasks) so no inappropriate next action survives.
 */
export async function markDnc(db: Queryable, actor: Actor, leadId: string, input: MarkDncInput) {
  if (!input.reason.trim()) throw new ValidationError("A reason is required to mark Do Not Contact.");
  const current = await getLeadRowOr404(db, leadId);
  if (current.lifecycle_state === "do_not_contact") return current;

  await db.query(
    `update public.leads
        set lifecycle_state = 'do_not_contact',
            dnc_reason = $2, dnc_by = $3, dnc_by_name = $4, dnc_at = now(),
            last_activity_at = now()
      where id = $1`,
    [leadId, input.reason.trim(), actor.id, actor.fullName],
  );

  await cancelOpenTasksForLead(db, actor, leadId, "Lead marked Do Not Contact");
  await addTimelineEvent(db, {
    leadId,
    kind: "system",
    title: "Do Not Contact",
    detail: input.reason.trim(),
    ...actorEvent(actor),
  });

  return getLeadRowOr404(db, leadId);
}

/**
 * Reactivating a DNC lead is an intentional, reasoned process (edge case:
 * "Do not automatically remove DNC" / "treat as a special intentional
 * process") — the DB trigger itself requires dnc_reason to be present on
 * the write or it raises, so a caller cannot accidentally clear DNC via a
 * generic patch.
 */
export async function reactivateFromDnc(db: Queryable, actor: Actor, leadId: string, reason: string) {
  if (!reason.trim()) throw new ValidationError("A reason is required to reactivate a Do Not Contact lead.");
  const current = await getLeadRowOr404(db, leadId);
  if (current.lifecycle_state !== "do_not_contact") {
    throw new ConflictError("Lead is not currently Do Not Contact.");
  }

  await db.query(
    `update public.leads
        set lifecycle_state = 'active', automation_mode = 'manual',
            dnc_reason = $2, dnc_by = $3, dnc_by_name = $4, dnc_at = now(),
            last_activity_at = now()
      where id = $1`,
    [leadId, reason.trim(), actor.id, actor.fullName],
  );

  await addTimelineEvent(db, { leadId, kind: "system", title: "Reactivated", detail: reason.trim(), ...actorEvent(actor) });
  return getLeadRowOr404(db, leadId);
}

async function setTerminalLifecycle(
  db: Queryable,
  actor: Actor,
  leadId: string,
  lifecycle: Exclude<LifecycleState, "active" | "do_not_contact" | "merged">,
  timelineTitle: string,
  reason?: string,
) {
  assertValidLifecycleState(lifecycle);
  const current = await getLeadRowOr404(db, leadId);
  if (current.lifecycle_state === lifecycle) return current;

  await db.query(`update public.leads set lifecycle_state = $2, last_activity_at = now() where id = $1`, [leadId, lifecycle]);
  await cancelOpenTasksForLead(db, actor, leadId, `Lead ${timelineTitle}`);
  await addTimelineEvent(db, { leadId, kind: "system", title: timelineTitle, detail: reason, ...actorEvent(actor) });
  return getLeadRowOr404(db, leadId);
}

export const markWon = (db: Queryable, actor: Actor, leadId: string, reason?: string) =>
  setTerminalLifecycle(db, actor, leadId, "won", "Won", reason);

export const markLost = (db: Queryable, actor: Actor, leadId: string, reason?: string) =>
  setTerminalLifecycle(db, actor, leadId, "lost", "Lost", reason);

export const markDiscarded = (db: Queryable, actor: Actor, leadId: string, reason?: string) =>
  setTerminalLifecycle(db, actor, leadId, "discarded", "Discarded", reason);

export async function moveToLongTermNurture(db: Queryable, actor: Actor, leadId: string, reason?: string) {
  const current = await getLeadRowOr404(db, leadId);
  if (current.lifecycle_state === "long_term_nurture") return current;
  await db.query(`update public.leads set lifecycle_state = 'long_term_nurture', last_activity_at = now() where id = $1`, [leadId]);
  await addTimelineEvent(db, { leadId, kind: "system", title: "Moved to Long-Term Nurture", detail: reason, ...actorEvent(actor) });
  return getLeadRowOr404(db, leadId);
}

/**
 * Reactivating a Lost/Discarded/Long-Term-Nurture lead back to active,
 * retaining all prior history (edge case: "Reactivation").
 */
export async function reactivateLead(db: Queryable, actor: Actor, leadId: string, reason?: string) {
  const current = await getLeadRowOr404(db, leadId);
  if (current.lifecycle_state === "do_not_contact") {
    throw new ConflictError("This lead is Do Not Contact — use the DNC reactivation endpoint instead.");
  }
  if (current.lifecycle_state === "merged") {
    throw new ConflictError("This lead was merged into another lead and cannot be reactivated directly.");
  }
  if (current.lifecycle_state === "active") return current;

  await db.query(
    `update public.leads set lifecycle_state = 'active', automation_mode = 'manual', last_activity_at = now() where id = $1`,
    [leadId],
  );
  await addTimelineEvent(db, { leadId, kind: "system", title: "Reactivated", detail: reason, ...actorEvent(actor) });
  return getLeadRowOr404(db, leadId);
}

/**
 * Merge model (edge case: "Duplicate Lead"). The source lead is marked
 * merged and points at the target; its full history (notes/calls/tasks/
 * meetings/proposals/timeline) stays queryable under its own id rather than
 * being reparented, which is the safer choice for not losing anything.
 */
export async function mergeLead(db: Queryable, actor: Actor, sourceLeadId: string, targetLeadId: string, reason?: string) {
  if (sourceLeadId === targetLeadId) throw new ValidationError("A lead cannot be merged into itself.");
  const source = await getLeadRowOr404(db, sourceLeadId);
  const target = await getLeadRowOr404(db, targetLeadId);
  if (source.lifecycle_state === "merged") throw new ConflictError("Source lead is already merged.");
  if (target.lifecycle_state === "merged") throw new ConflictError("Target lead is itself a merged (absorbed) lead.");

  await db.query(
    `update public.leads set lifecycle_state = 'merged', merged_into_lead_id = $2, last_activity_at = now() where id = $1`,
    [sourceLeadId, targetLeadId],
  );
  await cancelOpenTasksForLead(db, actor, sourceLeadId, "Lead merged");
  await addTimelineEvent(db, {
    leadId: sourceLeadId,
    kind: "system",
    title: "Merged",
    detail: reason ?? `Merged into ${target.first_name} ${target.last_name} (${target.company})`,
    ...actorEvent(actor),
  });
  await addTimelineEvent(db, {
    leadId: targetLeadId,
    kind: "system",
    title: "Absorbed Duplicate Lead",
    detail: reason ?? `Absorbed ${source.first_name} ${source.last_name} (${source.company})`,
    ...actorEvent(actor),
  });

  return getLeadRowOr404(db, sourceLeadId);
}

export interface SetContactabilityInput {
  channel: ContactChannel;
  status: string;
  reason?: string;
}

/**
 * Per-channel contactability (product brief: "a bad phone number must not
 * invalidate the whole lead"). Independent of lifecycle/stage entirely.
 */
export async function setContactability(db: Queryable, actor: Actor, leadId: string, input: SetContactabilityInput) {
  const allowed = CONTACT_CHANNEL_STATUS[input.channel];
  if (!allowed.includes(input.status)) {
    throw new ValidationError(`"${input.status}" is not a valid status for channel "${input.channel}".`, { allowed });
  }
  await getLeadRowOr404(db, leadId);

  await db.query(
    `insert into public.lead_contact_channels (lead_id, channel, status, reason, updated_by, updated_by_name)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (lead_id, channel)
     do update set status = excluded.status, reason = excluded.reason, updated_at = now(),
                   updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name`,
    [leadId, input.channel, input.status, input.reason ?? null, actor.id, actor.fullName],
  );

  await addTimelineEvent(db, {
    leadId,
    kind: "system",
    title: `${input.channel} contactability: ${input.status}`,
    detail: input.reason,
    ...actorEvent(actor),
  });

  return listContactability(db, leadId);
}

export async function listContactability(db: Queryable, leadId: string) {
  const result = await db.query<{ channel: ContactChannel; status: string; reason: string | null; updated_at: Date }>(
    `select channel, status, reason, updated_at from public.lead_contact_channels where lead_id = $1`,
    [leadId],
  );
  return result.rows.map((r) => ({ channel: r.channel, status: r.status, reason: r.reason ?? undefined, updatedAt: r.updated_at.toISOString() }));
}

export async function logManualCommunication(
  db: Queryable,
  actor: Actor,
  leadId: string,
  input: { channel: "email" | "whatsapp"; detail?: string },
) {
  const lead = await getLeadRowOr404(db, leadId);
  if (lead.lifecycle_state === "do_not_contact") {
    throw new DoNotContactError();
  }
  const title = input.channel === "email" ? "Email Sent" : "WhatsApp Sent";
  await addTimelineEvent(db, {
    leadId,
    kind: input.channel,
    title,
    detail: input.detail?.trim() || `Manual ${input.channel} from lead record`,
    ...actorEvent(actor),
  });
  await db.query(`update public.leads set last_activity_at = now() where id = $1`, [leadId]);
  return { channel: input.channel, title };
}
