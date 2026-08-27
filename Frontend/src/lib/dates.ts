import { TODAY } from "@/mocks/seed";

/**
 * Timestamp written to records the user changes during a session.
 *
 * Pinned to midday on the prototype's fixed clock so edits sort correctly
 * against the seeded history instead of jumping to the real current date.
 * Becomes `new Date().toISOString()` once the backend owns timestamps.
 */
export const NOW = `${TODAY}T12:00:00`;

/**
 * ISO timestamp `days` from the prototype's fixed clock, used when scheduling
 * a follow-up.
 */
export function addDays(days: number, time = "10:00:00") {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.toISOString().slice(0, 10)}T${time}`;
}
