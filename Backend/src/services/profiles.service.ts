import type { Queryable } from "../dto.js";
import { hasClientAccessSql, hasFullProjectAccessSql } from "./platform-sync.service.js";

/**
 * CRM access lives in crm_profiles; name/email come read-only from the platform's
 * public.revenueos_profiles. Use as `from crm_profiles p ${PROFILE_JOIN}`.
 * A missing name falls back to the email.
 */
export const PROFILE_JOIN = `left join public.revenueos_profiles rp on rp.id = p.id`;
export const PROFILE_COLUMNS = `p.id, p.role, p.is_active, p.created_at,
  coalesce(rp.email, '') as email,
  coalesce(nullif(trim(rp.full_name), ''), rp.email, '') as full_name`;

/** Display name of a user id column, e.g. `${userNameSql("d.owner_id")} as owner_name`. */
export function userNameSql(idColumn: string) {
  return `(select coalesce(nullif(trim(rp.full_name), ''), rp.email) from public.revenueos_profiles rp where rp.id = ${idColumn})`;
}

export interface ProfileRow {
  id: string;
  role: "admin" | "salesperson";
  is_active: boolean;
  created_at: Date;
  email: string;
  full_name: string;
}

export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

export function profileToDto(row: ProfileRow) {
  return {
    id: row.id,
    name: row.full_name,
    email: row.email,
    initials: initials(row.full_name),
    role: row.role,
    active: row.is_active,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * The people who can own a deal/task in a workspace: the workspace's platform project owner and its
 * salesperson members (revenueos_project_members), read from the platform. Clients are excluded —
 * a read-only client never owns work. Empty when the workspace has no linked project.
 */
export async function listProfiles(db: Queryable, workspaceId: string) {
  const result = await db.query<ProfileRow>(
    `with ws as (select platform_project_id as pid from crm_workspaces where id = $1)
     select rp.id as id,
            'salesperson'::public.crm_user_role as role,
            true as is_active,
            now() as created_at,
            coalesce(rp.email, '') as email,
            coalesce(nullif(trim(rp.full_name), ''), rp.email, '') as full_name
       from public.revenueos_profiles rp, ws
      where ws.pid is not null
        and (
          rp.id = (select owner_id from public.revenueos_projects where id = ws.pid)
          or rp.id in (select user_id from public.revenueos_project_members where project_id = ws.pid and role <> 'client')
        )
      order by full_name asc`,
    [workspaceId],
  );
  return result.rows.map(profileToDto);
}

/** The CRM user for a signed-in platform account, or why they have no access. */
export type ResolvedActor =
  | {
      status: "ok";
      actor: { id: string; fullName: string; email: string; isActive: true; role: "admin" | "salesperson" | "client" };
    }
  | { status: "deactivated" }
  | { status: "no_access" };

/**
 * CRM access is derived from the platform, with a kept `crm_profiles` override. In order:
 *  - admin: an active `crm_profiles` row with role 'admin'.
 *  - salesperson (full read + write): an active `crm_profiles` salesperson row (kept so admins'
 *    staff and existing rows keep working), OR owns / is a non-client member of any platform project.
 *  - client (read-only): is a client member of any platform project, with no full access anywhere.
 *  - otherwise no access. An explicitly deactivated crm_profiles row is blocked outright.
 * name/email always come from revenueos_profiles.
 */
export async function resolveActor(db: Queryable, userId: string): Promise<ResolvedActor> {
  const result = await db.query<{
    email: string;
    full_name: string;
    role: "admin" | "salesperson" | null;
    is_active: boolean | null;
    has_full_access: boolean;
    has_client_access: boolean;
  }>(
    `select
        coalesce(rp.email, '') as email,
        coalesce(nullif(trim(rp.full_name), ''), rp.email, '') as full_name,
        cp.role as role,
        cp.is_active as is_active,
        ${hasFullProjectAccessSql("$1")} as has_full_access,
        ${hasClientAccessSql("$1")} as has_client_access
      from public.revenueos_profiles rp
      left join crm_profiles cp on cp.id = rp.id
      where rp.id = $1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) return { status: "no_access" };
  if (row.is_active === false) return { status: "deactivated" }; // an explicitly deactivated crm_profiles row
  const isAdmin = row.role === "admin" && row.is_active === true;
  // A kept crm_profiles row (admin or salesperson, active) grants full access on its own, so admins'
  // staff and existing salesperson rows keep working even without a platform project.
  const hasCrmProfile = row.role != null && row.is_active === true;
  if (!hasCrmProfile && !row.has_full_access && !row.has_client_access) return { status: "no_access" };
  // Admin, a kept crm_profiles row, and full project access all mean full (salesperson) access;
  // a client-only membership is the sole read-only case.
  const role = isAdmin ? "admin" : hasCrmProfile || row.has_full_access ? "salesperson" : "client";
  return { status: "ok", actor: { id: userId, fullName: row.full_name, email: row.email, isActive: true, role } };
}
