/** DEMO MODE ONLY. Seed times that must land on a particular IST day. */

const IST_OFFSET_MS = 330 * 60_000; // Asia/Kolkata is UTC+05:30 all year.

/**
 * A time still later today in IST, so the seeded meeting is always under "Today": 23:30 IST,
 * or 23:59 IST once 23:30 has passed (in the last minute of the day that is just before now,
 * but still today).
 */
export function laterTodayIst(now = new Date()): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const at = (hour: number, minute: number) =>
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), hour, minute) - IST_OFFSET_MS;
  const halfPast = at(23, 30);
  return new Date(halfPast > now.getTime() ? halfPast : at(23, 59)).toISOString();
}
