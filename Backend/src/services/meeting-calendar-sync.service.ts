import { pool } from "../db.js";
import { getDealOr404 } from "./deals.service.js";
import { loadGoogleCalendarConnection, markGoogleCalendarReauthRequired } from "./connections.service.js";
import {
  CalendarSyncError,
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
} from "../providers/google-calendar.provider.js";

/** If Google rejected the stored token, flip the connection to "error" so the user sees a Reconnect prompt. */
async function flagReauthIfRevoked(workspaceId: string, error: unknown): Promise<void> {
  if (error instanceof CalendarSyncError && error.reauthRequired) {
    await markGoogleCalendarReauthRequired(workspaceId, error.message);
  }
}

/**
 * Syncs a meeting to the shared Google Calendar connection, best-effort:
 * every function here swallows its own errors and persists
 * calendar_sync_status/calendar_sync_error on the meeting row instead of
 * throwing, because Calendar being disconnected or erroring must never
 * block scheduling/rescheduling/cancelling a meeting — the meeting row
 * itself is already committed by the time any of these run (see the
 * two-step create/update in meetings.routes.ts, mirroring
 * proposalSending.service.ts's transactional-insert-then-best-effort-send
 * split).
 */

// Matches Frontend/src/lib/dates.ts APP_TIME_ZONE — this app is single-
// tenant IST throughout, not a new assumption introduced by Calendar sync.
const MEETING_TIME_ZONE = "Asia/Kolkata";

interface MeetingForSync {
  id: string;
  workspace_id: string;
  deal_id: string;
  title: string;
  scheduled_at: Date;
  duration_minutes: number;
  calendar_event_id: string | null;
}

async function getMeetingForSync(meetingId: string): Promise<MeetingForSync | undefined> {
  const result = await pool.query<MeetingForSync>(
    `select id, workspace_id, deal_id, title, scheduled_at, duration_minutes, calendar_event_id from crm_meetings where id = $1`,
    [meetingId],
  );
  return result.rows[0];
}

async function getMeetingParticipants(meetingId: string): Promise<{ name: string | null; email: string }[]> {
  const result = await pool.query<{ name: string | null; email: string }>(
    `select name, email from crm_meeting_participants where meeting_id = $1`,
    [meetingId],
  );
  return result.rows;
}

function eventWindow(meeting: MeetingForSync): { startIso: string; endIso: string } {
  return {
    startIso: meeting.scheduled_at.toISOString(),
    endIso: new Date(meeting.scheduled_at.getTime() + meeting.duration_minutes * 60_000).toISOString(),
  };
}

/** Creates the Calendar event for a newly scheduled meeting, adding the contact and any extra participants as attendees. */
export async function syncMeetingCreated(meetingId: string): Promise<void> {
  const meeting = await getMeetingForSync(meetingId);
  if (!meeting) return;

  const { row: connection, refreshToken, oauthConfig } = await loadGoogleCalendarConnection(meeting.workspace_id);
  if (connection.status !== "connected" || !refreshToken || !oauthConfig) {
    await pool.query(`update crm_meetings set calendar_sync_status = 'not_applicable' where id = $1`, [meetingId]);
    return;
  }

  try {
    const [deal, participants] = await Promise.all([
      getDealOr404(pool, meeting.workspace_id, meeting.deal_id),
      getMeetingParticipants(meetingId),
    ]);
    const attendees = [
      ...(deal.email ? [{ email: deal.email, displayName: `${deal.first_name} ${deal.last_name}`.trim() }] : []),
      ...participants.map((p) => ({ email: p.email, displayName: p.name ?? undefined })),
    ];
    const { startIso, endIso } = eventWindow(meeting);

    const result = await createCalendarEvent({
      oauth: oauthConfig,
      calendarId: connection.connected_calendar_id,
      refreshToken,
      summary: meeting.title,
      description: `Meeting with ${deal.company_name ?? `${deal.first_name} ${deal.last_name}`.trim()} via Northbeam CRM.`,
      startIso,
      endIso,
      timeZone: MEETING_TIME_ZONE,
      attendees,
    });
    await pool.query(
      `update crm_meetings
          set calendar_event_id = $2, meet_link = $3, calendar_sync_status = 'synced', calendar_sync_error = null
        where id = $1`,
      [meetingId, result.eventId, result.meetLink],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync meeting to Google Calendar.";
    await pool.query(`update crm_meetings set calendar_sync_status = 'failed', calendar_sync_error = $2 where id = $1`, [meetingId, message]);
    await flagReauthIfRevoked(meeting.workspace_id, error);
  }
}

/** Updates the Calendar event's title/time after a reschedule. No-op if the meeting never got an event (Calendar wasn't connected when it was created). */
export async function syncMeetingRescheduled(meetingId: string): Promise<void> {
  const meeting = await getMeetingForSync(meetingId);
  if (!meeting || !meeting.calendar_event_id) return;

  const { row: connection, refreshToken, oauthConfig } = await loadGoogleCalendarConnection(meeting.workspace_id);
  if (connection.status !== "connected" || !refreshToken || !oauthConfig) return;

  try {
    const { startIso, endIso } = eventWindow(meeting);
    await updateCalendarEvent({
      oauth: oauthConfig,
      calendarId: connection.connected_calendar_id,
      refreshToken,
      eventId: meeting.calendar_event_id,
      summary: meeting.title,
      startIso,
      endIso,
      timeZone: MEETING_TIME_ZONE,
    });
    await pool.query(`update crm_meetings set calendar_sync_status = 'synced', calendar_sync_error = null where id = $1`, [meetingId]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update the Google Calendar event.";
    await pool.query(`update crm_meetings set calendar_sync_status = 'failed', calendar_sync_error = $2 where id = $1`, [meetingId, message]);
    await flagReauthIfRevoked(meeting.workspace_id, error);
  }
}

/** Deletes the Calendar event when a meeting is cancelled. The meeting itself stays cancelled in our system even if Google's copy can't be removed. */
export async function syncMeetingCancelled(meetingId: string): Promise<void> {
  const meeting = await getMeetingForSync(meetingId);
  if (!meeting || !meeting.calendar_event_id) return;

  const { row: connection, refreshToken, oauthConfig } = await loadGoogleCalendarConnection(meeting.workspace_id);
  if (connection.status !== "connected" || !refreshToken || !oauthConfig) return;

  try {
    await deleteCalendarEvent({ oauth: oauthConfig, calendarId: connection.connected_calendar_id, refreshToken, eventId: meeting.calendar_event_id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete the Google Calendar event.";
    await pool.query(`update crm_meetings set calendar_sync_error = $2 where id = $1`, [meetingId, message]);
    await flagReauthIfRevoked(meeting.workspace_id, error);
  }
}
