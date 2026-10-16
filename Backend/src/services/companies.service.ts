import type { Actor } from "../authMiddleware.js";
import type { Queryable } from "../dto.js";
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
         (select count(*)::int from crm.contacts c where c.company_id = co.id and c.status <> 'merged') as contact_count,
         (select count(*)::int from crm.deals d where d.company_id = co.id and d.outcome = 'open') as open_deal_count
    from crm.companies co`;

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

export interface ListCompaniesFilters {
  search?: string;
  ownerId?: string;
  industry?: string;
  limit?: number;
  offset?: number;
}

export async function listCompanies(db: Queryable, workspaceId: string, f: ListCompaniesFilters) {
  const params: unknown[] = [workspaceId];
  const where = [`co.workspace_id = $1`];
  if (f.ownerId) where.push(`co.owner_id = $${params.push(f.ownerId)}`);
  if (f.industry) where.push(`lower(co.industry) = lower($${params.push(f.industry)})`);
  if (f.search) {
    const p = `$${params.push(`%${f.search}%`)}`;
    where.push(`(co.name ilike ${p} or co.domain ilike ${p} or co.industry ilike ${p})`);
  }
  const limit = Math.min(f.limit ?? 50, 500);
  const result = await db.query<CompanyRow & { total: number }>(
    `select co.*, count(*) over()::int as total from (${COMPANY_SELECT}) co
      where ${where.join(" and ")}
      order by co.name asc
      limit $${params.push(limit)} offset $${params.push(f.offset ?? 0)}`,
    params,
  );
  return { data: result.rows.map(companyToDto), total: result.rows[0]?.total ?? 0, limit, offset: f.offset ?? 0 };
}

/** Distinct industries in the workspace (case-insensitive), for the list filter. */
export async function listIndustries(db: Queryable, workspaceId: string) {
  const result = await db.query<{ industry: string }>(
    `select min(industry) as industry from crm.companies
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
  if (isUniqueViolation(err, "companies_workspace_domain_key")) {
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
      `insert into crm.companies
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

  await db.query(`update crm.companies set ${sets.join(", ")} where id = $${params.push(id)}`, params).catch(domainConflict);
  await addTimelineEvent(db, { companyId: id, kind: "system", title: "Company Updated", ...actorEvent(actor) });
  return getCompanyOr404(db, workspaceId, id);
}

/** Permanent delete with an audit snapshot. Contacts and deals stay; their company link is cleared. */
export async function deleteCompany(db: Queryable, actor: Actor, workspaceId: string, id: string) {
  const company = await getCompanyOr404(db, workspaceId, id);
  await writeDeletedAudit(db, actor, workspaceId, "company", id, companyToDto(company));
  await db.query(`delete from crm.companies where id = $1`, [id]);
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
    `insert into crm.deleted_records_audit (workspace_id, entity_type, entity_id, snapshot, deleted_by, deleted_by_name)
     values ($1, $2, $3, $4, $5, $6)`,
    [workspaceId, entityType, entityId, JSON.stringify(snapshot), actor.id, actor.fullName],
  );
}

/** For CSV import: same domain, else same name (case-insensitive), else a new company. */
export async function findOrCreateCompany(
  db: Queryable,
  actor: Actor,
  workspaceId: string,
  input: { name: string; website?: string | null; industry?: string | null },
): Promise<string> {
  const domain = normalizeDomain(input.website);
  const found = await db.query<{ id: string }>(
    `select id from crm.companies
      where workspace_id = $1 and (($2::text is not null and lower(domain) = $2) or lower(name) = lower($3))
      order by (lower(domain) = $2) desc nulls last, created_at asc
      limit 1`,
    [workspaceId, domain, input.name.trim()],
  );
  if (found.rows[0]) return found.rows[0].id;
  return (await createCompany(db, actor, workspaceId, { ...input, source: null })).id;
}
