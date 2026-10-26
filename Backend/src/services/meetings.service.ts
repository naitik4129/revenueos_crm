import { pageSql, START_OF_TODAY_IST, subjectNamesJoin, subjectNamesToDto, type Page, type Queryable, type SubjectNames } from "../dto.js";
import type { Actor } from "../authMiddleware.js";
import { ConflictError, DoNotContactError, NotFoundError, ValidationError } from "../errors.js";
import type { MeetingOutcome, MeetingStatus } from "../domain/enums.js";
import type { TemplateRenderMeeting } from "../domain/templateRenderer.js";
import { routeMeetingOutcome } from "../domain/meetingRouting.js";
import { pipelineStageIndex } from "../domain/pipeline.js";
import { addDaysIso } from "../dto.js";
import { userNameSql } from "./profiles.service.js";
import { addTimelineEvent, actorEvent } from "./timeline.service.js";
import { cancelOpenTasksForDeal, createTask } from "./tasks.service.js";
import { getDealOr404, markWon, moveToNurture, updateDeal } from "./deals.service.js";
import { autoEnroll, cancelRunsForDeal } from "./runs.service.js";

export interface MeetingRow extends SubjectNames {
  id: string;
  workspace_id: string;
  deal_id: string;
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
  created_at: Date;
  updated_at: Date;
}

const MEETING_SELECT = `select m.*, ${userNameSql("m.owner_id")} as owner_name, names.* from crm_meetings m ${subjectNamesJoin("m.deal_id")}`;

function meetingToDto(row: MeetingRow) {
  return {
    id: row.id,
    dealId: row.deal_id,
    ...subjectNamesToDto(row),
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
  dealId: string;
  ownerId?: string;
  title: string;
  at: string;
  durationMin?: number;
  url?: string;
  participants?: ScheduleMeetingParticipant[];
}

export async function scheduleMeeting(db: Queryable, actor: Actor, workspaceId: string, input: ScheduleMeetingInput) {
  if (!input.title.trim()) throw new ValidationError("Meeting title is required.");
  const deal = await getDealOr404(db, workspaceId, input.dealId);
  if (deal.contact_status === "do_not_contact") throw new DoNotContactError();
  if (deal.outcome !== "open") throw new ConflictError(`Meetings can only be booked on an open deal (this one is "${deal.outcome}").`);
  const ownerId = input.ownerId ?? deal.owner_id ?? actor.id;

  // A booked meeting has a confirmed time, so it starts as 'scheduled', not the DB default 'tentative'.
  const id = (
    await db.query<{ id: string }>(
      `insert into crm_meetings (workspace_id, deal_id, owner_id, title, scheduled_at, duration_minutes, meeting_url, status, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,'scheduled',$8) returning id`,
      [workspaceId, input.dealId, ownerId, input.title.trim(), input.at, input.durationMin ?? 30, input.url ?? null, actor.id],
    )
  ).rows[0]!.id;

  for (const p of (input.participants ?? []).filter((p) => p.email.trim())) {
    await db.query(`insert into crm_meeting_participants (meeting_id, name, email) values ($1, $2, $3)`, [id, p.name?.trim() || null, p.email.trim()]);
  }
  await addTimelineEvent(db, { dealId: input.dealId, kind: "meeting", title: "Meeting Scheduled", detail: input.title.trim(), ...actorEvent(actor), relatedMeetingId: id });

  // Only forward: a deal already past meeting_scheduled (e.g. proposal_sent) is not moved back.
  if (pipelineStageIndex(deal.stage) < pipelineStageIndex("meeting_scheduled")) {
    await updateDeal(db, actor, workspaceId, input.dealId, { stage: "meeting_scheduled" });
  }
  // The nurture's goal (a booked meeting) is reached: its runs and follow-ups are obsolete.
  await cancelRunsForDeal(db, input.dealId, "Meeting booked - nurture objective reached");
  await cancelOpenTasksForDeal(db, actor, input.dealId, "Superseded by scheduled meeting", ["follow_up", "nurture", "schedule_meeting", "call"]);
  await createTask(db, actor, workspaceId, { dealId: input.dealId, ownerId, type: "confirm_meeting", title: "Prepare for the meeting", dueAt: input.at });
  await autoEnroll(db, workspaceId, input.dealId, "meeting_scheduled", `Meeting scheduled: ${input.title.trim()}`);

  return getMeetingOr404(db, workspaceId, id);
}

export async function getMeetingOr404(db: Queryable, workspaceId: string, id: string) {
  return meetingToDto(await getMeetingRowOr404(db, workspaceId, id));
}

export async function getMeetingRowOr404(db: Queryable, workspaceId: string, id: string): Promise<MeetingRow> {
  const result = await db.query<MeetingRow>(`${MEETING_SELECT} where m.id = $1 and m.workspace_id = $2`, [id, workspaceId]);
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Meeting");
  return row;
}

/** The meeting a deal's automation renders against: the newest one that is still happening or happened. */
export async function getLatestMeetingForDeal(db: Queryable, dealId: string): Promise<MeetingRow | null> {
  const result = await db.query<MeetingRow>(
    `${MEETING_SELECT} where m.deal_id = $1 and m.status not in ('cancelled', 'failed') order by m.created_at desc limit 1`,
    [dealId],
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

export const MEETING_WHEN = ["upcoming", "past", "today"] as const;

export interface ListMeetingsFilters {
  dealId?: string;
  status?: MeetingStatus;
  ownerId?: string;
  /** Asia/Kolkata days: upcoming = from the start of today (soonest first), past = before it (latest first). */
  when?: (typeof MEETING_WHEN)[number];
}

export async function listMeetings(db: Queryable, workspaceId: string, f: ListMeetingsFilters, page?: Page) {
  const params: unknown[] = [workspaceId];
  const where = [`m.workspace_id = $1`];
  if (f.dealId) where.push(`m.deal_id = $${params.push(f.dealId)}`);
  if (f.status) where.push(`m.status = $${params.push(f.status)}`);
  if (f.ownerId) where.push(`m.owner_id = $${params.push(f.ownerId)}`);
  if (f.when === "upcoming") where.push(`m.scheduled_at >= ${START_OF_TODAY_IST}`);
  if (f.when === "past") where.push(`m.scheduled_at < ${START_OF_TODAY_IST}`);
  if (f.when === "today") where.push(`m.scheduled_at >= ${START_OF_TODAY_IST} and m.scheduled_at < ${START_OF_TODAY_IST} + interval '1 day'`);
  const direction = f.when === "past" ? "desc" : "asc";
  const result = await db.query<MeetingRow & { total: number }>(
    `select q.*, count(*) over()::int as total from (${MEETING_SELECT} where ${where.join(" and ")}) q
      order by q.scheduled_at ${direction}, q.id ${pageSql(params, page)}`,
    params,
  );
  return { data: result.rows.map(meetingToDto), total: result.rows[0]?.total ?? 0 };
}

export interface UpdateMeetingInput {
  title?: string;
  at?: string;
  durationMin?: number;
  url?: string;
  status?: MeetingStatus;
  notes?: string;
}

/** Plain field/status edits with no outcome routing; use recordMeetingOutcome for Completed + outcome. */
export async function updateMeeting(db: Queryable, actor: Actor, workspaceId: string, id: string, patch: UpdateMeetingInput) {
  const current = await getMeetingRowOr404(db, workspaceId, id);
  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, value: unknown) => sets.push(`${col} = $${params.push(value)}`);
  if (patch.title !== undefined) set("title", patch.title.trim());
  if (patch.at !== undefined) set("scheduled_at", patch.at);
  if (patch.durationMin !== undefined) set("duration_minutes", patch.durationMin);
  if (patch.url !== undefined) set("meeting_url", patch.url || null);
  if (patch.status !== undefined) {
    set("status", patch.status);
    // crm_meetings_outcome_requires_completed: leaving 'completed' must clear the outcome.
    if (patch.status !== "completed") set("outcome", null);
  }
  if (patch.notes !== undefined) set("notes", patch.notes);
  if (sets.length === 0) return meetingToDto(current);

  await db.query(`update crm_meetings set ${sets.join(", ")} where id = $${params.push(id)}`, params);

  if (patch.status && patch.status !== current.status) {
    const title = patch.status === "rescheduled" ? "Meeting Rescheduled" : patch.status === "cancelled" ? "Meeting Cancelled" : `Meeting ${patch.status}`;
    await addTimelineEvent(db, { dealId: current.deal_id, kind: "meeting", title, ...actorEvent(actor), relatedMeetingId: id });
    // The "Prepare for the meeting" task only makes sense while the meeting will happen.
    if (patch.status === "cancelled" || patch.status === "no_show" || patch.status === "failed") {
      await cancelOpenTasksForDeal(db, actor, current.deal_id, "Meeting was cancelled", ["confirm_meeting"]);
    }
  }
  return getMeetingOr404(db, workspaceId, id);
}

/**
 * Meeting outcome routing (CONTEXT.md, "Meeting routing"). Marks the meeting completed. An exact
 * repeat is a no-op: its side effects (tasks, stage) are not safe to re-run.
 */
export async function recordMeetingOutcome(db: Queryable, actor: Actor, workspaceId: string, id: string, outcome: MeetingOutcome, notes?: string) {
  const meeting = await getMeetingRowOr404(db, workspaceId, id);
  if (meeting.status === "completed" && meeting.outcome === outcome) return meetingToDto(meeting);

  await db.query(`update crm_meetings set status = 'completed', outcome = $2, notes = coalesce($3, notes) where id = $1`, [id, outcome, notes ?? null]);
  await addTimelineEvent(db, { dealId: meeting.deal_id, kind: "meeting", title: "Meeting Completed", detail: `Outcome: ${outcome}`, ...actorEvent(actor), relatedMeetingId: id });

  const routing = routeMeetingOutcome(outcome);
  // Stage first: it can only change while the deal is still open. Stage + objection type in one update.
  if (routing.stage || routing.objectionType) {
    await updateDeal(db, actor, workspaceId, meeting.deal_id, {
      ...(routing.stage ? { stage: routing.stage } : {}),
      ...(routing.objectionType ? { objectionType: routing.objectionType } : {}),
    });
  }
  if (routing.outcome === "nurture") await moveToNurture(db, actor, workspaceId, meeting.deal_id, `Meeting outcome: ${outcome}`);
  if (routing.outcome === "won") await markWon(db, actor, workspaceId, meeting.deal_id, `Meeting outcome: ${outcome}`);
  if (routing.task) {
    await createTask(db, actor, workspaceId, {
      dealId: meeting.deal_id,
      ownerId: meeting.owner_id,
      type: routing.task.type,
      title: routing.task.title,
      dueAt: addDaysIso(routing.task.dueInDays),
    });
  }
  if (routing.workflowTrigger) {
    await autoEnroll(db, workspaceId, meeting.deal_id, routing.workflowTrigger, `Meeting outcome: ${outcome}`);
  }
  return getMeetingOr404(db, workspaceId, id);
}
