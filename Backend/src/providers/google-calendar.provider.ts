import { randomUUID } from "node:crypto";
import { google } from "googleapis";

/** The OAuth client is configured but a Calendar API call itself failed. */
export class CalendarSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarSyncError";
  }
}

// calendar.events is the actual permission we need; userinfo.email is only
// so exchangeCodeForTokens can show the admin *which* Google account got
// connected — without it, Google rejects the userinfo lookup below with an
// insufficient-scope error and connected_email silently stays null even
// though the connection itself succeeded.
const SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/userinfo.email"];

/**
 * The app's own OAuth client registration (client_id/client_secret/redirect_uri).
 * Deliberately NOT read from environment variables anywhere in this file —
 * an admin enters these in Admin -> Connections and they're stored
 * encrypted in public.google_calendar_connection (see connections.service.ts),
 * the same as the Resend API key for email. Every function here takes this
 * config as an explicit argument so the provider has no hidden credential
 * source of its own.
 */
export interface GoogleOAuthClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

function newOAuthClient(config: GoogleOAuthClientConfig) {
  return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
}

export function getAuthorizationUrl(config: GoogleOAuthClientConfig, state: string): string {
  const client = newOAuthClient(config);
  return client.generateAuthUrl({
    access_type: "offline",
    // Forces Google to reissue a refresh token even when this app was
    // previously authorized by the same account — without this, a
    // reconnect after a manual revoke can silently come back with no
    // refresh_token at all.
    prompt: "consent",
    scope: SCOPES,
    state,
  });
}

export async function exchangeCodeForTokens(
  config: GoogleOAuthClientConfig,
  code: string,
): Promise<{ refreshToken: string; email: string | null }> {
  const client = newOAuthClient(config);
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new CalendarSyncError(
      "Google did not return a refresh token. In your Google Account's Security settings, remove this app's prior access, then connect again.",
    );
  }
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const userinfo = await oauth2.userinfo.get().catch((err) => {
    // Non-fatal — the Calendar connection itself still succeeded (we have a
    // refresh token). Losing just the display email shouldn't fail the
    // whole connect flow, but silently swallowing it makes a real scope
    // problem look identical to "worked fine, nothing to show" — log it.
    console.warn("[google-calendar] Failed to look up the connected account's email:", err instanceof Error ? err.message : err);
    return null;
  });
  return { refreshToken: tokens.refresh_token, email: userinfo?.data.email ?? null };
}

function authorizedClient(config: GoogleOAuthClientConfig, refreshToken: string) {
  const client = newOAuthClient(config);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "Google Calendar request failed.";
}

function isGoneError(error: unknown): boolean {
  const status =
    (error as { code?: number })?.code ?? (error as { response?: { status?: number } })?.response?.status;
  return status === 404 || status === 410;
}

export interface CalendarAttendee {
  email: string;
  displayName?: string;
}

export interface CreateCalendarEventInput {
  oauth: GoogleOAuthClientConfig;
  refreshToken: string;
  calendarId: string;
  summary: string;
  description?: string;
  startIso: string;
  endIso: string;
  timeZone: string;
  attendees: CalendarAttendee[];
}

export interface CalendarEventResult {
  eventId: string;
  meetLink: string | null;
}

export async function createCalendarEvent(input: CreateCalendarEventInput): Promise<CalendarEventResult> {
  const calendar = google.calendar({ version: "v3", auth: authorizedClient(input.oauth, input.refreshToken) });
  try {
    const response = await calendar.events.insert({
      calendarId: input.calendarId,
      sendUpdates: "all",
      conferenceDataVersion: 1,
      requestBody: {
        summary: input.summary,
        description: input.description,
        start: { dateTime: input.startIso, timeZone: input.timeZone },
        end: { dateTime: input.endIso, timeZone: input.timeZone },
        attendees: input.attendees.map((a) => ({ email: a.email, displayName: a.displayName })),
        conferenceData: {
          createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } },
        },
      },
    });
    const event = response.data;
    if (!event.id) throw new CalendarSyncError("Google Calendar did not return an event id.");
    return { eventId: event.id, meetLink: event.hangoutLink ?? null };
  } catch (error) {
    if (error instanceof CalendarSyncError) throw error;
    throw new CalendarSyncError(messageFrom(error));
  }
}

export interface UpdateCalendarEventInput {
  oauth: GoogleOAuthClientConfig;
  refreshToken: string;
  calendarId: string;
  eventId: string;
  summary?: string;
  startIso?: string;
  endIso?: string;
  timeZone?: string;
}

export async function updateCalendarEvent(input: UpdateCalendarEventInput): Promise<void> {
  const calendar = google.calendar({ version: "v3", auth: authorizedClient(input.oauth, input.refreshToken) });
  try {
    await calendar.events.patch({
      calendarId: input.calendarId,
      eventId: input.eventId,
      sendUpdates: "all",
      requestBody: {
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
        ...(input.startIso && input.timeZone ? { start: { dateTime: input.startIso, timeZone: input.timeZone } } : {}),
        ...(input.endIso && input.timeZone ? { end: { dateTime: input.endIso, timeZone: input.timeZone } } : {}),
      },
    });
  } catch (error) {
    if (isGoneError(error)) return;
    throw new CalendarSyncError(messageFrom(error));
  }
}

export async function deleteCalendarEvent(input: {
  oauth: GoogleOAuthClientConfig;
  refreshToken: string;
  calendarId: string;
  eventId: string;
}): Promise<void> {
  const calendar = google.calendar({ version: "v3", auth: authorizedClient(input.oauth, input.refreshToken) });
  try {
    await calendar.events.delete({ calendarId: input.calendarId, eventId: input.eventId, sendUpdates: "all" });
  } catch (error) {
    // Already gone is fine — nothing left to clean up.
    if (isGoneError(error)) return;
    throw new CalendarSyncError(messageFrom(error));
  }
}
