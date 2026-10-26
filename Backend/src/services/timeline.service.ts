import type { Queryable } from "../dto.js";
import type { Actor } from "../authMiddleware.js";
import type { ActorSource } from "../domain/enums.js";

export type { ActorSource };

/**
 * Subject of an event. Pass the most specific one: a deal event also lands on its contact
 * (looked up here), a contact event on the contact only; companyId alone = company-level
 * event (removed with the company).
 */
export interface AddTimelineEventInput {
  companyId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  kind: string;
  title: string;
  detail?: string | null;
  actorId?: string | null;
  actorName: string;
  actorSource: ActorSource;
  relatedTaskId?: string | null;
  relatedMeetingId?: string | null;
  relatedProposalId?: string | null;
  relatedCallId?: string | null;
  relatedWorkflowRunId?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: Date;
  /** Brain event id; unique per workspace, so a re-sent event cannot be recorded twice. */
  external?: { source: string; id: string };
}

/**
 * Every business-meaningful change appends here. Append-only by design. workspace_id and
 * a deal's contact_id are taken from the subject rows, so callers cannot mismatch them.
 */
export async function addTimelineEvent(db: Queryable, input: AddTimelineEventInput) {
  await db.query(
    `insert into crm_timeline_events
      (workspace_id, company_id, contact_id, deal_id, occurred_at, event_kind, title, detail,
       actor_id, actor_name, actor_source, related_task_id, related_meeting_id, related_proposal_id,
       related_call_id, related_workflow_run_id, metadata, external_source, external_id)
     select coalesce(d.workspace_id, c.workspace_id, co.workspace_id),
            co.id, coalesce(c.id, d.contact_id), d.id,
            coalesce($4, now()), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
       from (select 1) one
       left join crm_deals d on d.id = $3
       left join crm_contacts c on c.id = $2
       left join crm_companies co on co.id = $1`,
    [
      input.companyId ?? null,
      input.contactId ?? null,
      input.dealId ?? null,
      input.occurredAt ?? null,
      input.kind,
      input.title,
      input.detail ?? null,
      input.actorId ?? null,
      input.actorName,
      input.actorSource,
      input.relatedTaskId ?? null,
      input.relatedMeetingId ?? null,
      input.relatedProposalId ?? null,
      input.relatedCallId ?? null,
      input.relatedWorkflowRunId ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.external?.source ?? null,
      input.external?.id ?? null,
    ],
  );
}

export function actorEvent(actor: Actor): { actorId: string; actorName: string; actorSource: "user" } {
  return { actorId: actor.id, actorName: actor.fullName, actorSource: "user" };
}

export const SYSTEM_ACTOR = { actorId: null, actorName: "System", actorSource: "system" as const };
export const AUTOMATION_ACTOR = { actorId: null, actorName: "Automation", actorSource: "automation" as const };
export const BRAIN_ACTOR = { actorId: null, actorName: "RevenueOS Brain", actorSource: "brain" as const };

/** Who an event is attributed to when it is not always a signed-in user. */
export type EventActor = Pick<AddTimelineEventInput, "actorId" | "actorName" | "actorSource">;

export interface TimelineInsertRow {
  company_id?: string | null;
  contact_id?: string | null;
  occurred_at?: string | null;
  event_kind: string;
  title: string;
  detail?: string | null;
  related_call_id?: string | null;
}

/** Many events by one actor in one statement (set-based writes). Subjects must be in this workspace. */
export async function insertTimelineRows(db: Queryable, workspaceId: string, actor: EventActor, rows: TimelineInsertRow[]) {
  if (!rows.length) return;
  await db.query(
    `insert into crm_timeline_events (workspace_id, company_id, contact_id, occurred_at, event_kind, title, detail, actor_id, actor_name, actor_source, related_call_id)
     select $1, x.company_id, x.contact_id, coalesce(x.occurred_at, now()), x.event_kind, x.title, x.detail, $2, $3, $4, x.related_call_id
       from jsonb_to_recordset($5::jsonb) as x(company_id uuid, contact_id uuid, occurred_at timestamptz, event_kind text, title text, detail text, related_call_id uuid)`,
    [workspaceId, actor.actorId ?? null, actor.actorName, actor.actorSource, JSON.stringify(rows)],
  );
}

/** A user -> user event; the brain/system -> as given; nobody -> automation. */
export function toEventActor(actor: Actor | EventActor | null): EventActor {
  return !actor ? AUTOMATION_ACTOR : "fullName" in actor ? actorEvent(actor) : actor;
}

interface TimelineRow {
  id: string;
  company_id: string | null;
  contact_id: string | null;
  deal_id: string | null;
  occurred_at: Date;
  event_kind: string;
  title: string;
  detail: string | null;
  actor_id: string | null;
  actor_name: string;
  actor_source: ActorSource;
  related_task_id: string | null;
  related_meeting_id: string | null;
  related_proposal_id: string | null;
  related_call_id: string | null;
  related_workflow_run_id: string | null;
  metadata: Record<string, unknown> | null;
}

export function timelineToDto(row: TimelineRow) {
  return {
    id: row.id,
    companyId: row.company_id ?? undefined,
    contactId: row.contact_id ?? undefined,
    dealId: row.deal_id ?? undefined,
    at: row.occurred_at.toISOString(),
    kind: row.event_kind,
    title: row.title,
    detail: row.detail ?? undefined,
    actor: row.actor_name,
    actorId: row.actor_id ?? undefined,
    source: row.actor_source,
    relatedTaskId: row.related_task_id ?? undefined,
    relatedMeetingId: row.related_meeting_id ?? undefined,
    relatedProposalId: row.related_proposal_id ?? undefined,
    relatedCallId: row.related_call_id ?? undefined,
    relatedWorkflowRunId: row.related_workflow_run_id ?? undefined,
    metadata: row.metadata ?? undefined,
  };
}

export interface TimelineQuery {
  companyId?: string;
  contactId?: string;
  dealId?: string;
  limit?: number;
  offset?: number;
}

/** Newest first, paginated. A contact's timeline includes its deal events. */
export async function listTimeline(db: Queryable, workspaceId: string, q: TimelineQuery) {
  const [column, value] = q.dealId ? ["deal_id", q.dealId] : q.contactId ? ["contact_id", q.contactId] : ["company_id", q.companyId];
  const result = await db.query<TimelineRow>(
    `select * from crm_timeline_events
      where workspace_id = $1 and ${column} = $2
      order by occurred_at desc, created_at desc
      limit $3 offset $4`,
    [workspaceId, value, Math.min(q.limit ?? 100, 500), q.offset ?? 0],
  );
  return result.rows.map(timelineToDto);
}
