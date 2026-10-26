import type { Queryable } from "../dto.js";

// The CRM is driven by the RevenueOS platform: access and workspaces come from the platform's
// public.revenueos_projects / revenueos_project_members (read-only; crm_app has select on them).
// A person may use a workspace because they own or are a member of its platform project.

/** SQL fragment: the user at `userIdSql` owns or is a member of the project at `projectIdSql`. */
export function ownsOrMemberOfProjectSql(projectIdSql: string, userIdSql: string): string {
  return `(exists (select 1 from public.revenueos_projects pp where pp.id = ${projectIdSql} and pp.owner_id = ${userIdSql})
           or exists (select 1 from public.revenueos_project_members pm where pm.project_id = ${projectIdSql} and pm.user_id = ${userIdSql}))`;
}

/** SQL fragment: the user at `userIdSql` owns or is a member of ANY platform project. */
export function hasAnyProjectAccessSql(userIdSql: string): string {
  return `(exists (select 1 from public.revenueos_projects pp where pp.owner_id = ${userIdSql})
           or exists (select 1 from public.revenueos_project_members pm where pm.user_id = ${userIdSql}))`;
}

/** A workspace name not already taken (case-insensitive); the platform customer name, suffixed only on a clash. */
async function uniqueName(db: Queryable, customerName: string, brainKey: string): Promise<string> {
  const base = customerName.trim();
  const taken = async (name: string) =>
    ((await db.query(`select 1 from crm_workspaces where lower(name) = lower($1)`, [name])).rowCount ?? 0) > 0;
  if (!(await taken(base))) return base;
  const withKey = `${base} (${brainKey})`;
  return (await taken(withKey)) ? `${base} (${brainKey.slice(-6)}-${Date.now().toString(36)})` : withKey;
}

/**
 * Creates a crm_workspaces row for each platform project the user may see that has none yet (admin:
 * every active project). slug = brain_customer_key (unique per project); name = the customer name,
 * made unique. Steady state inserts nothing (the "missing" query returns empty), so it is cheap to
 * call on every workspace listing.
 */
export async function ensureWorkspaces(db: Queryable, opts: { userId: string; isAdmin: boolean }): Promise<void> {
  const accessible = opts.isAdmin ? "true" : ownsOrMemberOfProjectSql("pr.id", "$1");
  const params = opts.isAdmin ? [] : [opts.userId];
  const missing = await db.query<{ id: string; customer_name: string; brain_customer_key: string }>(
    `select pr.id, pr.customer_name, pr.brain_customer_key
       from public.revenueos_projects pr
      where pr.archived_at is null
        and pr.brain_customer_key is not null
        and coalesce(trim(pr.customer_name), '') <> ''
        and ${accessible}
        and not exists (select 1 from crm_workspaces w where w.platform_project_id = pr.id)`,
    params,
  );
  for (const project of missing.rows) {
    const name = await uniqueName(db, project.customer_name, project.brain_customer_key);
    await db.query(
      `insert into crm_workspaces (name, slug, platform_project_id) values ($1, $2, $3)
       on conflict (platform_project_id) do nothing`,
      [name, project.brain_customer_key, project.id],
    );
  }
}
