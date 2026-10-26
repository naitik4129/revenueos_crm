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
        left join crm_deals nd on nd.id = s.deal_id
        join crm_contacts nc on nc.id = coalesce(s.contact_id, nd.contact_id)
        left join crm_companies nco on nco.id = coalesce(nd.company_id, nc.company_id)
    ) names on true`;
}

export interface SubjectNames {
  contact_name: string | null;
  company_name: string | null;
}

export function subjectNamesToDto(row: SubjectNames) {
  return { contactName: row.contact_name ?? undefined, companyName: row.company_name ?? undefined };
}

/** Paging for list services; deal-scoped lists pass none and get every row of that deal. */
export interface Page {
  limit: number;
  offset: number;
}

export function pageSql(params: unknown[], page?: Page): string {
  return page ? `limit $${params.push(page.limit)} offset $${params.push(page.offset)}` : "";
}

/** Allowed `sort` values for a list: each key ascending, or with a leading "-" descending. */
export function sortValues(columns: Record<string, string[]>): [string, ...string[]] {
  const keys = Object.keys(columns);
  return [...keys, ...keys.map((k) => `-${k}`)] as [string, ...string[]];
}

/**
 * `order by` for a list. `sort` is a key of `columns` (checked by the route), "-" for descending;
 * empty values always go last. The tie-break keeps paging stable when the sort values repeat.
 */
export function orderBySql(sort: string | undefined, columns: Record<string, string[]>, fallback: string, tieBreak: string): string {
  if (!sort) return `order by ${fallback}, ${tieBreak}`;
  const desc = sort.startsWith("-");
  const exprs = columns[desc ? sort.slice(1) : sort];
  if (!exprs) throw new Error(`Unknown sort "${sort}".`);
  return `order by ${exprs.map((e) => `${e} ${desc ? "desc" : "asc"} nulls last`).join(", ")}, ${tieBreak}`;
}

/**
 * One page of a list without building the whole filtered set. The ids are paged first
 * (`select <idColumn> <from> where … order by … limit/offset`: cheap columns only, so the 014
 * indexes can serve it), then `select` (ending in its FROM/joins) reads just those rows, in that
 * order. The total is a plain count(*) of the same filter, run alongside. `params` are the
 * filter's; limit and offset are added here.
 */
export async function pageOf<R extends object>(
  db: Queryable,
  q: { select: string; idColumn: string; from: string; where: string; order: string; params: unknown[]; limit: number; offset: number },
) {
  const n = q.params.length;
  const [rows, count] = await Promise.all([
    db.query<R>(
      `with page as (
         select p.id, p.ord from unnest(array(
           select ${q.idColumn} ${q.from} where ${q.where} ${q.order} limit $${n + 1} offset $${n + 2}
         )) with ordinality as p(id, ord)
       )
       ${q.select}
       join page on page.id = ${q.idColumn}
       order by page.ord`,
      [...q.params, q.limit, q.offset],
    ),
    db.query<{ total: number }>(`select count(*)::int as total ${q.from} where ${q.where}`, q.params),
  ]);
  return { rows: rows.rows, total: count.rows[0]!.total };
}

/** Start of today in Asia/Kolkata as a timestamptz SQL expression (same day boundary as tasks). */
export const START_OF_TODAY_IST = `(date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')`;
