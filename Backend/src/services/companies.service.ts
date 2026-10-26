import type { Actor } from "../authMiddleware.js";
import { orderBySql, pageOf, type Queryable } from "../dto.js";
import { ConflictError, isUniqueViolation, NotFoundError, ValidationError } from "../errors.js";
import { LEAD_SOURCES, type LeadSource } from "../domain/enums.js";
import { userNameSql } from "./profiles.service.js";
import { actorEvent, addTimelineEvent } from "./timeline.service.js";

export interface CompanyRow {
  id: string;
  workspace_id: string;
  name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  location: string | null;
  headcount: number | null;
  linkedin_url: string | null;
  owner_id: string | null;
  owner_name: string | null;
  source: LeadSource | null;
  contact_count: number;
  open_deal_count: number;
  created_at: Date;
  updated_at: Date;
}

const COMPANY_SELECT = `
  select co.*, ${userNameSql("co.owner_id")} as owner_name,
         (select count(*)::int from crm_contacts c where c.company_id = co.id and c.status <> 'merged') as contact_count,
         (select count(*)::int from crm_deals d where d.company_id = co.id and d.outcome = 'open') as open_deal_count
    from crm_companies co`;

export function companyToDto(row: CompanyRow) {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain ?? undefined,
    website: row.website ?? undefined,
    industry: row.industry ?? undefined,
    phone: row.phone ?? undefined,
    city: row.city ?? undefined,
    country: row.country ?? undefined,
    location: row.location ?? undefined,
    headcount: row.headcount ?? undefined,
    linkedinUrl: row.linkedin_url ?? undefined,
    ownerId: row.owner_id ?? undefined,
    ownerName: row.owner_name ?? undefined,
    source: row.source ?? undefined,
    contactCount: row.contact_count,
    openDealCount: row.open_deal_count,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** "https://www.Acme.com/about" -> "acme.com". Null when nothing usable is left. */
export function normalizeDomain(value: string | null | undefined): string | null {
  const v = value
    ?.trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
  return v && v.includes(".") ? v : null;
}

export interface CompanyInput {
  name?: string;
  domain?: string | null;
  website?: string | null;
  industry?: string | null;
  phone?: string | null;
  city?: string | null;
  country?: string | null;
  location?: string | null;
  headcount?: number | null;
  linkedinUrl?: string | null;
  ownerId?: string | null;
  source?: string | null;
}

const blank = (v: string | null | undefined) => v?.trim() || null;

export async function getCompanyOr404(db: Queryable, workspaceId: string, id: string): Promise<CompanyRow> {
  const result = await db.query<CompanyRow>(`${COMPANY_SELECT} where co.id = $1 and co.workspace_id = $2`, [id, workspaceId]);
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Company");
  return row;
}

/**
 * Sortable columns of the companies list (`sort` = key, or "-key" for descending). The counts are
 * the same as COMPANY_SELECT's, from one grouped join each (COUNT_JOINS) while paging.
 */
export const COMPANY_SORTS: Record<string, string[]> = {
  name: ["lower(co.name)"],
  contacts: ["coalesce(cc.n, 0)"],
  openDeals: ["coalesce(od.n, 0)"],
  created: ["co.created_at"],
};
const COUNT_JOINS: Record<string, string> = {
  contacts: `left join (select company_id, count(*)::int as n from crm_contacts
                         where workspace_id = $1 and company_id is not null and status <> 'merged' group by company_id) cc on cc.company_id = co.id`,
  openDeals: `left join (select company_id, count(*)::int as n from crm_deals
                          where workspace_id = $1 and company_id is not null and outcome = 'open' group by company_id) od on od.company_id = co.id`,
};

export interface ListCompaniesFilters {
  sort?: string;
  search?: string;
  ownerId?: string;
  industry?: string;
  limit?: number;
  offset?: number;
}

export async function listCompanies(db: Queryable, workspaceId: string, f: ListCompaniesFilters) {
  const params: unknown[] = [workspaceId];
  const where = [`co.workspace_id = $1`];
  if (f.ownerId) where.push(f.ownerId === "none" ? `co.owner_id is null` : `co.owner_id = $${params.push(f.ownerId)}`);
  if (f.industry) where.push(`lower(co.industry) = lower($${params.push(f.industry)})`);
  if (f.search) {
    const p = `$${params.push(`%${f.search}%`)}`;
    where.push(`(co.name ilike ${p} or co.domain ilike ${p} or co.industry ilike ${p})`);
  }
  const limit = Math.min(f.limit ?? 50, 500);
  const offset = f.offset ?? 0;
  // Filters read companies only: page first, then COMPANY_SELECT counts for the page's rows only.
  const countJoin = COUNT_JOINS[f.sort?.replace(/^-/, "") ?? ""];
  const { rows, total } = await pageOf<CompanyRow>(db, {
    select: COMPANY_SELECT,
    idColumn: "co.id",
    from: `from crm_companies co ${countJoin ?? ""}`,
    where: where.join(" and "),
    order: orderBySql(f.sort, COMPANY_SORTS, "co.name asc", "co.id"),
    params,
    limit,
    offset,
  });
  return { data: rows.map(companyToDto), total, limit, offset };
}

/** Distinct industries in the workspace (case-insensitive), for the list filter. */
export async function listIndustries(db: Queryable, workspaceId: string) {
  const result = await db.query<{ industry: string }>(
    `select min(industry) as industry from crm_companies
      where workspace_id = $1 and nullif(trim(industry), '') is not null
      group by lower(trim(industry)) order by 1`,
    [workspaceId],
  );
  return result.rows.map((r) => r.industry);
}

function validSource(source: string | null | undefined): LeadSource | null {
  if (!source) return null;
  if (!(LEAD_SOURCES as readonly string[]).includes(source)) {
    throw new ValidationError(`Unknown source "${source}" - must be one of: ${LEAD_SOURCES.join(", ")}.`, { field: "source" });
  }
  return source as LeadSource;
}

function domainConflict(err: unknown): never {
  if (isUniqueViolation(err, "crm_companies_workspace_domain_key")) {
    throw new ConflictError("A company with this domain already exists in this workspace.", { field: "domain" });
  }
  throw err;
}

export async function createCompany(db: Queryable, actor: Actor | null, workspaceId: string, input: CompanyInput): Promise<CompanyRow> {
  const name = input.name?.trim();
  if (!name) throw new ValidationError("Company name is required.", { field: "name" });
  const domain = normalizeDomain(input.domain ?? input.website);

  const id = await db
    .query<{ id: string }>(
      `insert into crm_companies
        (workspace_id, name, domain, website, industry, phone, city, country, location, headcount, linkedin_url, owner_id, source, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
      [
        workspaceId,
        name,
        domain,
        blank(input.website),
        blank(input.industry),
        blank(input.phone),
        blank(input.city),
        blank(input.country),
        blank(input.location),
        input.headcount ?? null,
        blank(input.linkedinUrl),
        input.ownerId ?? null,
        validSource(input.source),
        actor?.id ?? null,
      ],
    )
    .then((r) => r.rows[0]!.id, domainConflict);

  if (actor) await addTimelineEvent(db, { companyId: id, kind: "system", title: "Company Created", ...actorEvent(actor) });
  return getCompanyOr404(db, workspaceId, id);
}

export async function updateCompany(db: Queryable, actor: Actor, workspaceId: string, id: string, patch: CompanyInput) {
  await getCompanyOr404(db, workspaceId, id);
  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, value: unknown) => sets.push(`${col} = $${params.push(value)}`);

  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new ValidationError("Company name is required.", { field: "name" });
    set("name", patch.name.trim());
  }
  if (patch.domain !== undefined) set("domain", normalizeDomain(patch.domain));
  if (patch.website !== undefined) set("website", blank(patch.website));
  if (patch.industry !== undefined) set("industry", blank(patch.industry));
  if (patch.phone !== undefined) set("phone", blank(patch.phone));
  if (patch.city !== undefined) set("city", blank(patch.city));
  if (patch.country !== undefined) set("country", blank(patch.country));
  if (patch.location !== undefined) set("location", blank(patch.location));
  if (patch.headcount !== undefined) set("headcount", patch.headcount);
  if (patch.linkedinUrl !== undefined) set("linkedin_url", blank(patch.linkedinUrl));
  if (patch.ownerId !== undefined) set("owner_id", patch.ownerId);
  if (patch.source !== undefined) set("source", validSource(patch.source));
  if (sets.length === 0) return getCompanyOr404(db, workspaceId, id);

  await db.query(`update crm_companies set ${sets.join(", ")} where id = $${params.push(id)}`, params).catch(domainConflict);
  await addTimelineEvent(db, { companyId: id, kind: "system", title: "Company Updated", ...actorEvent(actor) });
  return getCompanyOr404(db, workspaceId, id);
}

/** Permanent delete with an audit snapshot. Contacts and deals stay; their company link is cleared. */
export async function deleteCompany(db: Queryable, actor: Actor, workspaceId: string, id: string) {
  const company = await getCompanyOr404(db, workspaceId, id);
  await writeDeletedAudit(db, actor, workspaceId, "company", id, companyToDto(company));
  await db.query(`delete from crm_companies where id = $1`, [id]);
}

export async function writeDeletedAudit(
  db: Queryable,
  actor: Actor,
  workspaceId: string,
  entityType: "company" | "contact" | "deal",
  entityId: string,
  snapshot: unknown,
) {
  await db.query(
    `insert into crm_deleted_records_audit (workspace_id, entity_type, entity_id, snapshot, deleted_by, deleted_by_name)
     values ($1, $2, $3, $4, $5, $6)`,
    [workspaceId, entityType, entityId, JSON.stringify(snapshot), actor.id, actor.fullName],
  );
}
