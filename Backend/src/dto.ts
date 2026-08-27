import type { Pool, PoolClient } from "pg";

/** Anything that can run a parameterized query — a bare Pool for reads, or a
 * transaction PoolClient for writes that must be atomic with other writes. */
export type Queryable = Pool | PoolClient;

export function isoOrNull(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : v;
}

export function addDaysIso(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}
