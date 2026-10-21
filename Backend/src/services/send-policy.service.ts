import type { Queryable } from "../dto.js";
import { sendBlockReason } from "./consent.service.js";
import { notifyAdmins } from "./notifications.service.js";

/**
 * Sending limits per workspace and channel (crm.send_policies, migration 015). The worker calls
 * checkSendPolicy right before every workflow send, in this order: paused -> working hours (IST)
 * -> daily cap with warm-up ramp -> random gap -> consent. Over a limit the send is deferred to
 * the next allowed time (never dropped); a consent block is a skip. An allowed send reserves its
 * slot (counted today, next one not before now + a random gap) under the row lock, so sends
 * processed side by side still go one gap apart.
 */

export type SendChannel = "email" | "whatsapp";

/** Defaults for a policy row created on first use. */
export const SEND_POLICY_DEFAULTS: Record<SendChannel, { dailyCap: number; rampStart: number; rampStepPerDay: number; minGapSeconds: number; maxGapSeconds: number }> = {
  email: { dailyCap: 50, rampStart: 20, rampStepPerDay: 5, minGapSeconds: 60, maxGapSeconds: 180 },
  whatsapp: { dailyCap: 60, rampStart: 20, rampStepPerDay: 5, minGapSeconds: 45, maxGapSeconds: 120 },
};

/** How long a send waits before looking at a paused channel again. */
const PAUSED_RETRY_MS = 60 * 60_000;
const IST_OFFSET_MS = 330 * 60_000; // Asia/Kolkata is UTC+05:30 all year (no DST).
const DAY_MS = 86_400_000;

export interface SendPolicyRow {
  workspace_id: string;
  channel: SendChannel;
  paused: boolean;
  pause_reason: string | null;
  paused_at: Date | null;
  daily_cap: number;
  ramp_start: number;
  ramp_step_per_day: number;
  ramp_started_at: Date | null;
  min_gap_seconds: number;
  max_gap_seconds: number;
  window_start: string;
  window_end: string;
  window_days: number[];
  counter_day: string | null;
  sent_today: number;
  next_send_at: Date | null;
  updated_at: Date;
}

/** The policy row, created with the channel's defaults if missing. `forUpdate` locks it. */
export async function getSendPolicy(db: Queryable, workspaceId: string, channel: SendChannel, forUpdate = false): Promise<SendPolicyRow> {
  const d = SEND_POLICY_DEFAULTS[channel];
  await db.query(
    `insert into crm.send_policies (workspace_id, channel, daily_cap, ramp_start, ramp_step_per_day, min_gap_seconds, max_gap_seconds)
     values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing`,
    [workspaceId, channel, d.dailyCap, d.rampStart, d.rampStepPerDay, d.minGapSeconds, d.maxGapSeconds],
  );
  const row = (
    await db.query<SendPolicyRow>(
      `select *, counter_day::text as counter_day, to_char(window_start, 'HH24:MI') as window_start, to_char(window_end, 'HH24:MI') as window_end
         from crm.send_policies where workspace_id = $1 and channel = $2 ${forUpdate ? "for update" : ""}`,
      [workspaceId, channel],
    )
  ).rows[0]!;
  return { ...row, window_days: row.window_days.map(Number) };
}

/** IST calendar date (YYYY-MM-DD), ISO weekday and minute of the day for an instant. */
export function istParts(at: Date) {
  const local = new Date(at.getTime() + IST_OFFSET_MS);
  return { date: local.toISOString().slice(0, 10), isoDay: local.getUTCDay() || 7, minute: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

/** The instant of minute `minute` (may be 1440 = midnight after) on IST date `date`. */
const istInstant = (date: string, minute: number) => new Date(Date.parse(`${date}T00:00:00Z`) - IST_OFFSET_MS + minute * 60_000);
const toMinute = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
};

/** Whole IST calendar days from `from` to `to`. */
export const istDaysBetween = (from: Date, to: Date) => Math.round((Date.parse(istParts(to).date) - Date.parse(istParts(from).date)) / DAY_MS);

/** Today's cap: the ramp (ramp_start + step per IST day since it started) up to daily_cap. */
export function capForDay(policy: Pick<SendPolicyRow, "daily_cap" | "ramp_start" | "ramp_step_per_day" | "ramp_started_at">, now: Date) {
  const days = policy.ramp_started_at ? Math.max(0, istDaysBetween(policy.ramp_started_at, now)) : 0;
  return Math.min(policy.daily_cap, policy.ramp_start + policy.ramp_step_per_day * days);
}

const inWindow = (policy: Pick<SendPolicyRow, "window_start" | "window_end" | "window_days">, at: Date) => {
  const p = istParts(at);
  return policy.window_days.includes(p.isoDay) && p.minute >= toMinute(policy.window_start) && p.minute < toMinute(policy.window_end);
};

/** The first window opening at or after `from` (`from` itself when it is inside a window). */
export function nextWindowStart(policy: Pick<SendPolicyRow, "window_start" | "window_end" | "window_days">, from: Date): Date {
  if (inWindow(policy, from)) return from;
  const start = toMinute(policy.window_start);
  for (let d = 0; d <= 7; d++) {
    const p = istParts(new Date(from.getTime() + d * DAY_MS));
    const opens = istInstant(p.date, start);
    if (policy.window_days.includes(p.isoDay) && opens >= from) return opens;
  }
  return new Date(from.getTime() + PAUSED_RETRY_MS); // unreachable with a valid row (1-7 days)
}

const label = (channel: SendChannel) => (channel === "email" ? "Email" : "WhatsApp");

export type SendPolicyVerdict =
  | { ok: true }
  | { ok: false; kind: "defer"; reason: string; retryAt: Date }
  | { ok: false; kind: "skip"; reason: string };

/**
 * Checks one send against the workspace's policy for its channel and, when it may go, reserves
 * its slot. Run inside a transaction (the policy row stays locked until it commits).
 */
export async function checkSendPolicy(
  db: Queryable,
  input: { workspaceId: string; channel: SendChannel; contactId: string },
  now = new Date(),
  random = Math.random,
): Promise<SendPolicyVerdict> {
  const policy = await getSendPolicy(db, input.workspaceId, input.channel, true);
  const name = label(input.channel);

  if (policy.paused) return { ok: false, kind: "defer", reason: `${name} sending is paused: ${policy.pause_reason}`, retryAt: new Date(now.getTime() + PAUSED_RETRY_MS) };
  if (!inWindow(policy, now)) {
    return { ok: false, kind: "defer", reason: `Outside ${name} sending hours (${policy.window_start}-${policy.window_end} IST).`, retryAt: nextWindowStart(policy, now) };
  }

  const today = istParts(now).date;
  const sentToday = policy.counter_day === today ? policy.sent_today : 0;
  const cap = capForDay(policy, now);
  if (sentToday >= cap) {
    const tomorrow = istInstant(today, 1440);
    return { ok: false, kind: "defer", reason: `${name} daily cap reached (${sentToday}/${cap} today).`, retryAt: nextWindowStart(policy, tomorrow) };
  }
  if (policy.next_send_at && policy.next_send_at > now) {
    return { ok: false, kind: "defer", reason: `${name} send gap: next send not before ${policy.next_send_at.toISOString()}.`, retryAt: policy.next_send_at };
  }

  const blocked = await sendBlockReason(db, input.contactId, input.channel);
  if (blocked) return { ok: false, kind: "skip", reason: blocked };

  const gapMs = Math.round((policy.min_gap_seconds + random() * (policy.max_gap_seconds - policy.min_gap_seconds)) * 1000);
  await db.query(
    `update crm.send_policies
        set counter_day = $3, sent_today = $4, next_send_at = $5, ramp_started_at = coalesce(ramp_started_at, $6)
      where workspace_id = $1 and channel = $2`,
    [input.workspaceId, input.channel, today, sentToday + 1, new Date(now.getTime() + gapMs).toISOString(), now.toISOString()],
  );
  return { ok: true };
}

/**
 * Pauses a channel automatically (bounce rate, WhatsApp logout/restriction/failures) and alerts
 * active admins. Does nothing when it is already paused. Returns whether it paused it now.
 */
export async function autoPauseChannel(db: Queryable, workspaceId: string, channel: SendChannel, reason: string) {
  const policy = await getSendPolicy(db, workspaceId, channel, true);
  if (policy.paused) return false;
  await db.query(`update crm.send_policies set paused = true, pause_reason = $3, paused_at = now() where workspace_id = $1 and channel = $2`, [workspaceId, channel, reason]);
  await notifyAdmins(db, {
    workspaceId,
    title: `${label(channel)} sending paused automatically`,
    detail: `${reason} Check it, then resume in Admin → Sending.`,
    href: "/admin",
  });
  return true;
}
