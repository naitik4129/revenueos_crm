/**
 * Fixed prototype clock.
 *
 * The mock data is authored as offsets from this date so "today", "overdue"
 * and "tomorrow" stay meaningful without the dataset drifting. When the
 * backend replaces the seed, this constant goes with it and `lib/format`
 * switches to the real current date.
 */
export const TODAY = "2026-08-26";

/** ISO date `offset` days from TODAY. */
export const d = (offset: number) => {
  const base = Date.parse(`${TODAY}T00:00:00Z`) + offset * 86400000;
  return new Date(base).toISOString().slice(0, 10);
};

/** ISO timestamp `offset` days from TODAY at `time` (HH:mm). */
export const at = (offset: number, time: string) => `${d(offset)}T${time}:00`;
