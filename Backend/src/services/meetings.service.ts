import type { Queryable } from "../dto.js";
import type { Actor } from "../authMiddleware.js";
import { DoNotContactError, NotFoundError, ValidationError } from "../errors.js";
import type { MeetingOutcome, MeetingStatus } from "../domain/enums.js";
import type { TemplateRenderMeeting } from "../domain/templateRenderer.js";
import { routeMeetingOutcome } from "../domain/meetingRouting.js";
import { addTimelineEvent, actorEvent } from "./timeline.service.js";
import { cancelOpenTasksForLead, createTask } from "./tasks.service.js";
import { getLeadRowOr404, markWon, moveToLongTermNurture, updateLead, type LeadRow } from "./leads.service.js";
import { autoEnroll, cancelRunsForLead } from "./runs.service.js";
import { addDaysIso } from "../dto.js";
import { pipelineStageIndex } from "../domain/pipeline.js";

export interface MeetingRow {
  id: string;
  workspace_id: string;
  lead_id: string;
  owner_id: string | null;
  owner_name: string | null;
  title: string;
  scheduled_at: Date;
  duration_minutes: number;
  meeting_url: string | null;
  status: MeetingStatus;
  outcome: MeetingOutcome | null;
  notes: string | null;
  calendar_event_id: string | null;
  meet_link: string | null;
  calendar_sync_status: "not_applicable" | "pending" | "synced" | "failed";
  calendar_sync_error: string | null;
  notify_email_status: "not_applicable" | "pending" | "skipped" | "sent" | "failed";
  notify_email_sent_at: Date | null;
  notify_email_error: string | null;
  notify_whatsapp_status: "not_applicable" | "skipped" | "queued" | "sending" | "sent" | "failed";
  notify_whatsapp_sent_at: Date | null;
  notify_whatsapp_error: string | null;
  notify_whatsapp_next_attempt_at: Date | null;
  notify_whatsapp_attempt_count: number;
  created_by: string | null;
  created_by_name: string | null;
  created_at: Date;
  updated_at: Date;
}

function meetingToDto(row: MeetingRow) {
  return {
    id: row.id,
    leadId: row.lead_id,
    ownerId: row.owner_id ?? undefined,
    ownerName: row.owner_name ?? undefined,
    title: row.title,
    at: row.scheduled_at.toISOString(),
    durationMin: row.duration_minutes,
    url: row.meeting_url ?? undefined,
    status: row.status,
    outcome: row.outcome ?? undefined,
    notes: row.notes ?? undefined,
    meetLink: row.meet_link ?? undefined,
    calendarSyncStatus: row.calendar_sync_status,
    calendarSyncError: row.calendar_sync_error ?? undefined,
    notifyEmailStatus: row.notify_email_status,
    notifyEmailError: row.notify_email_error ?? undefined,
    notifyWhatsappStatus: row.notify_whatsapp_status,
    notifyWhatsappError: row.notify_whatsapp_error ?? undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface ScheduleMeetingParticipant {
  name?: string;
  email: string;
}

export interface ScheduleMeetingInput {
  leadId: string;
  ownerId?: string;
  title: string;
  at: string;
  durationMin?: number;
  url?: string;
  participants?: ScheduleMeetingParticipant[];
}

/** The meeting's owner is usually the lead's owner or the acting salesperson — both names are already on hand; only an explicit cross-assignment (input.ownerId pointing at someone else) needs a lookup. */
async function resolveOwnerName(db: Queryable, ownerId: string, lead: LeadRow, actor: Actor): Promise<string | null> {
  if (ownerId === lead.owner_id) return lead.owner_name;
  if (ownerId === actor.id) return actor.fullName;
  const result = await db.query<{ full_name: string }>(`select full_name from public.profiles where id = $1`, [ownerId]);
  return result.rows[0]?.full_name ?? null;
}

export async function scheduleMeeting(db: Queryable, actor: Actor, workspaceId: string, input: ScheduleMeetingInput) {
  if (!input.title.trim()) throw new ValidationError("Meeting title is required.");
  const lead = await getLeadRowOr404(db, workspaceId, input.leadId);
  if (lead.lifecycle_state === "do_not_contact") throw new DoNotContactError();

  const ownerId = input.ownerId ?? lead.owner_id ?? actor.id;
  const ownerName = await resolveOwnerName(db, ownerId, lead, actor);

  // A booked meeting has a confirmed date/time, so it starts life as
  // 'scheduled' rather than the DB default 'tentative' (which is reserved
  // for a not-yet-implemented "propose a time" flow) — intentional, not a bug.
  const result = await db.query<{ id: string }>(
    `insert into public.meetings (workspace_id, lead_id, owner_id, owner_name, title, scheduled_at, duration_minutes, meeting_url, status, created_by, created_by_name)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'scheduled',$9,$10) returning id`,
    [workspaceId, input.leadId, ownerId, ownerName, input.title.trim(), input.at, input.durationMin ?? 30, input.url ?? null, actor.id, actor.fullName],
  );
  const id = result.rows[0]!.id;

  const participants = (input.participants ?? []).filter((p) => p.email.trim());
  for (const participant of participants) {
    await db.query(`insert into public.meeting_participants (meeting_id, name, email) values ($1,$2,$3)`, [
      id,
      participant.name?.trim() || null,
      participant.email.trim(),
    ]);
  }

  await addTimelineEvent(db, { leadId: input.leadId, kind: "meeting", title: "Meeting Scheduled", detail: input.title.trim(), ...actorEvent(actor) });

  // Only advance the funnel forward — a lead already past meeting_scheduled
  // (e.g. proposal_sent) must not be regressed by booking an additional
  // meeting on it.
  if (pipelineStageIndex(lead.pipeline_stage) < pipelineStageIndex("meeting_scheduled")) {
    await updateLead(db, actor, workspaceId, input.leadId, { pipelineStage: "meeting_scheduled" });
  }

  // Edge case ("Meeting Booked During Nurture"): the objective of any
  // in-flight nurture was to get a meeting booked — now that it has been,
  // the old meeting-CTA nurture and its follow-up tasks are obsolete.
  await cancelRunsForLead(db, input.leadId, "Meeting booked - nurture objective reached");
  await cancelOpenTasksForLead(db, actor, input.leadId, "Superseded by scheduled meeting", [
    "follow_up",
    "nurture",
    "schedule_meeting",
    "call",
  ]);

  await createTask(db, actor, workspaceId, {
    leadId: input.leadId,
    ownerId,
    type: "confirm_meeting",
    title: "Prepare for the meeting",
    dueAt: input.at,
    origin: "manual",
  });

  return getMeetingOr404(db, workspaceId, id);
}

export async function getMeetingOr404(db: Queryable, workspaceId: string, id: string) {
  return meetingToDto(await getMeetingRowOr404(db, workspaceId, id));
}

export async function getMeetingRowOr404(db: Queryable, workspaceId: string, id: string): Promise<MeetingRow> {
  const result = await db.query<MeetingRow>(`select * from public.meetings where id = $1 and workspace_id = $2`, [id, workspaceId]);
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Meeting");
  return row;
}

/**
 * The meeting a lead's automation should render against — most recently
 * created, excluding ones that never happened or won't. Takes leadId only
 * (no workspaceId): every caller (automation.service.ts's buildContext)
 * already has a workspace-validated lead in hand before calling this.
 */
export async function getLatestMeetingForLead(db: Queryable, leadId: string): Promise<MeetingRow | null> {
  const result = await db.query<MeetingRow>(
    `select * from public.meetings where lead_id = $1 and status not in ('cancelled', 'failed') order by created_at desc limit 1`,
    [leadId],
  );
  return result.rows[0] ?? null;
}

export function toRenderMeeting(meeting: MeetingRow): TemplateRenderMeeting {
  return {
    title: meeting.title,
    at: meeting.scheduled_at.toISOString(),
    durationMin: meeting.duration_minutes,
    link: meeting.meet_link ?? meeting.meeting_url,
  };
}

export interface ListMeetingsFilters {
  leadId?: string;
  status?: MeetingStatus;
  ownerId?: string;
}

export async function listMeetings(db: Queryable, workspaceId: string, filters: ListMeetingsFilters) {
  const clauses: string[] = [`workspace_id = $1`];
  const params: unknown[] = [workspaceId];
  let i = 2;
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
  const where = `where ${clauses.join(" and ")}`;
  const result = await db.query<MeetingRow>(`select * from public.meetings ${where} order by scheduled_at asc`, params);
  return result.rows.map(meetingToDto);
}

export interface UpdateMeetingInput {
  title?: string;
  at?: string;
  durationMin?: number;
  url?: string;
  status?: MeetingStatus;
  notes?: string;
}

/** Plain field/status edits with no outcome routing — use recordMeetingOutcome for Completed + outcome. */
export async function updateMeeting(db: Queryable, actor: Actor, workspaceId: string, id: string, patch: UpdateMeetingInput) {
  const current = await getMeetingRowOr404(db, workspaceId, id);
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  const push = (col: string, value: unknown) => {
    sets.push(`${col} = $${i++}`);
    params.push(value);
  };
  if (patch.title !== undefined) push("title", patch.title.trim());
  if (patch.at !== undefined) push("scheduled_at", patch.at);
  if (patch.durationMin !== undefined) push("duration_minutes", patch.durationMin);
  if (patch.url !== undefined) push("meeting_url", patch.url || null);
  if (patch.status !== undefined) {
    push("status", patch.status);
    // DB constraint meetings_outcome_requires_completed forbids a non-null
    // outcome on any status other than 'completed' — moving a meeting away
    // from 'completed' (e.g. rescheduling one that already has an outcome)
    // must clear it here, or the update below throws a raw constraint error.
    if (patch.status !== "completed") push("outcome", null);
  }
  if (patch.notes !== undefined) push("notes", patch.notes);
  if (sets.length === 0) return meetingToDto(current);

  params.push(id);
  await db.query(`update public.meetings set ${sets.join(", ")} where id = $${i}`, params);

  if (patch.status && patch.status !== current.status) {
    const title = patch.status === "rescheduled" ? "Meeting Rescheduled" : patch.status === "cancelled" ? "Meeting Cancelled" : `Meeting ${patch.status}`;
    await addTimelineEvent(db, { leadId: current.lead_id, kind: "meeting", title, ...actorEvent(actor), relatedMeetingId: id });

    // The auto-created "Prepare for the meeting" task is only meaningful
    // while the meeting is still going to happen — without this, cancelling
    // or no-showing a meeting leaves a stale prep task behind.
    if (patch.status === "cancelled" || patch.status === "no_show" || patch.status === "failed") {
      await cancelOpenTasksForLead(db, actor, current.lead_id, "Meeting was cancelled", ["confirm_meeting"]);
    }
  }

  return getMeetingOr404(db, workspaceId, id);
}

/**
 * Meeting outcome routing (product brief, "MEETINGS"). Only valid once the
 * meeting is marked Completed (mirrors the DB CHECK constraint
 * meetings_outcome_requires_completed).
 */
export async function recordMeetingOutcome(db: Queryable, actor: Actor, workspaceId: string, id: string, outcome: MeetingOutcome, notes?: string) {
  const meeting = await getMeetingRowOr404(db, workspaceId, id);

  // Idempotent on an exact repeat (double-submit / retried request): the
  // routing side effects below (task creation, stage change) are NOT safe to
  // re-run, so a no-op return here is required, not just an optimization. A
  // genuine correction to a *different* outcome still goes through normally.
  if (meeting.status === "completed" && meeting.outcome === outcome) {
    return meetingToDto(meeting);
  }

  await db.query(
    `update public.meetings set status = 'completed', outcome = $2, notes = coalesce($3, notes) where id = $1`,
    [id, outcome, notes ?? null],
  );
  await addTimelineEvent(db, {
    leadId: meeting.lead_id,
    kind: "meeting",
    title: "Meeting Completed",
    detail: `Outcome: ${outcome}`,
    ...actorEvent(actor),
    relatedMeetingId: id,
  });

  const routing = routeMeetingOutcome(outcome);
  // stage and objectionType must land in one update statement — see the
  // identical constraint note in calls.service.ts::logCall.
  if (routing.stage || routing.objectionType) {
    await updateLead(db, actor, workspaceId, meeting.lead_id, {
      ...(routing.stage ? { pipelineStage: routing.stage } : {}),
      ...(routing.objectionType ? { objectionType: routing.objectionType } : {}),
    });
  }
  if (routing.lifecycle === "long_term_nurture") await moveToLongTermNurture(db, actor, workspaceId, meeting.lead_id, `Meeting outcome: ${outcome}`);
  if (routing.lifecycle === "won") await markWon(db, actor, workspaceId, meeting.lead_id, `Meeting outcome: ${outcome}`);
  if (routing.task) {
    await createTask(db, actor, workspaceId, {
      leadId: meeting.lead_id,
      ownerId: meeting.owner_id,
      type: routing.task.type,
      title: routing.task.title,
      dueAt: addDaysIso(routing.task.dueInDays),
      origin: "manual",
    });
  }
  if (routing.workflowTrigger) {
    await autoEnroll(db, workspaceId, meeting.lead_id, routing.workflowTrigger, `Meeting outcome: ${outcome}`);
  }

  return getMeetingOr404(db, workspaceId, id);
}
