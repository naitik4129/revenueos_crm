import type { Queryable } from "../dto.js";

/**
 * CRM access lives in crm.profiles; name/email come read-only from the platform's
 * public.revenueos_profiles. Use as `from crm.profiles p ${PROFILE_JOIN}`.
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

/** Salespeople, for owner pickers. */
export async function listProfiles(db: Queryable) {
  const result = await db.query<ProfileRow>(
    `select ${PROFILE_COLUMNS} from crm.profiles p ${PROFILE_JOIN}
      where p.role = 'salesperson'
      order by full_name asc`,
  );
  return result.rows.map(profileToDto);
}

export async function getProfile(db: Queryable, id: string) {
  const result = await db.query<ProfileRow>(`select ${PROFILE_COLUMNS} from crm.profiles p ${PROFILE_JOIN} where p.id = $1`, [id]);
  const row = result.rows[0];
  return row ? profileToDto(row) : null;
}
