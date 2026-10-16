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

/**
 * Lateral join adding `contact_name` and `company_name` for a row with a deal and/or a contact
 * (the contact defaults to the deal's; the deal's company wins, else the contact's).
 */
export function subjectNamesJoin(dealIdCol: string, contactIdCol = "null::uuid"): string {
  return `left join lateral (
      select nullif(trim(concat_ws(' ', nc.first_name, nc.last_name)), '') as contact_name, nco.name as company_name
        from (select ${dealIdCol} as deal_id, ${contactIdCol} as contact_id) s
        left join crm.deals nd on nd.id = s.deal_id
        join crm.contacts nc on nc.id = coalesce(s.contact_id, nd.contact_id)
        left join crm.companies nco on nco.id = coalesce(nd.company_id, nc.company_id)
    ) names on true`;
}

export interface SubjectNames {
  contact_name: string | null;
  company_name: string | null;
}

export function subjectNamesToDto(row: SubjectNames) {
  return { contactName: row.contact_name ?? undefined, companyName: row.company_name ?? undefined };
}
