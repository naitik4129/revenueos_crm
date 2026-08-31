import type { Queryable } from "../dto.js";

export async function listProfiles(db: Queryable) {
  const result = await db.query<{ id: string; full_name: string; email: string; initials: string; is_active: boolean }>(
    `select id, full_name, email, initials, is_active
       from public.profiles
      where role = 'salesperson'
      order by full_name asc`,
  );
  return result.rows.map((r) => ({ id: r.id, name: r.full_name, email: r.email, initials: r.initials, active: r.is_active }));
}

export async function getProfile(db: Queryable, id: string) {
  const result = await db.query<{ id: string; full_name: string; email: string; initials: string; is_active: boolean }>(
    `select id, full_name, email, initials, is_active from public.profiles where id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { id: row.id, name: row.full_name, email: row.email, initials: row.initials, active: row.is_active };
}
