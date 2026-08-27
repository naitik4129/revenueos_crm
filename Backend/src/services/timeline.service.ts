import type { Queryable } from "../dto.js";
import type { Actor } from "../authMiddleware.js";

export type ActorSource = "manual" | "automation" | "system";

export interface AddTimelineEventInput {
  leadId: string;
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
}

/**
 * Every business-meaningful change appends here (Rule 5: every important
 * state change stays historically traceable). Append-only by design — the
 * table has no update/delete RLS policy either.
 */
export async function addTimelineEvent(db: Queryable, input: AddTimelineEventInput) {
  await db.query(
    `insert into public.timeline_events
      (lead_id, occurred_at, event_kind, title, detail, actor_id, actor_name, actor_source,
       related_task_id, related_meeting_id, related_proposal_id, related_call_id,
       related_workflow_run_id, metadata)
     values ($1, coalesce($2, now()), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      input.leadId,
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
    ],
  );
}

export function actorEvent(actor: Actor): { actorId: string; actorName: string; actorSource: "manual" } {
  return { actorId: actor.id, actorName: actor.fullName, actorSource: "manual" };
}

export const SYSTEM_ACTOR = { actorId: null, actorName: "System", actorSource: "system" as const };
export const AUTOMATION_ACTOR = { actorId: null, actorName: "Automation", actorSource: "automation" as const };

interface TimelineRow {
  id: string;
  lead_id: string;
  occurred_at: Date;
  event_kind: string;
  title: string;
  detail: string | null;
  actor_id: string | null;
  actor_name: string;
  actor_source: string;
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
    leadId: row.lead_id,
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

export async function listTimelineForLead(db: Queryable, leadId: string) {
  const result = await db.query<TimelineRow>(
    `select * from public.timeline_events where lead_id = $1 order by occurred_at asc`,
    [leadId],
  );
  return result.rows.map(timelineToDto);
}
