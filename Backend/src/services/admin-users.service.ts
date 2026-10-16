import type { Actor } from "../authMiddleware.js";
import { pool, withTransaction } from "../db.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors.js";
import { recordAdminAudit } from "./admin-audit.service.js";
import { getProfile, PROFILE_COLUMNS, PROFILE_JOIN, profileToDto, type ProfileRow } from "./profiles.service.js";

type Role = "admin" | "salesperson";

export async function listUsers() {
  const result = await pool.query<ProfileRow>(
    `select ${PROFILE_COLUMNS} from crm.profiles p ${PROFILE_JOIN} order by p.created_at desc`,
  );
  return result.rows.map(profileToDto);
}

export interface CreateUserInput {
  email: string;
  role?: Role;
}

/**
 * Gives an existing shared RevenueOS account (platform or brain user) CRM access by adding its
 * crm.profiles row. The CRM never creates auth users: accounts are made on the platform.
 */
export async function createUser(actor: Actor, input: CreateUserInput) {
  const email = input.email.trim().toLowerCase();
  const role = input.role ?? "salesperson";

  const existing = await pool.query<{ id: string }>(
    `select id from public.revenueos_profiles where lower(email) = $1`,
    [email],
  );
  const id = existing.rows[0]?.id;
  if (!id) {
    throw new ValidationError("No RevenueOS account with this email — create it on the platform first.", { field: "email" });
  }

  await withTransaction(async (db) => {
    const inserted = await db.query(
      `insert into crm.profiles (id, role) values ($1, $2) on conflict (id) do nothing returning id`,
      [id, role],
    );
    if (!inserted.rows[0]) throw new ConflictError("This person already has CRM access.", { field: "email" });
    await recordAdminAudit(db, actor, "user.created", "profile", id, { email, role });
  });
  return (await getProfile(pool, id))!;
}

export interface UpdateUserInput {
  role?: Role;
  active?: boolean;
}

/**
 * Changes CRM role/access only. Deactivating sets crm.profiles.is_active = false and never
 * touches the shared Supabase account (name, email and password belong to the platform).
 */
export async function updateUser(actor: Actor, id: string, input: UpdateUserInput) {
  if (id === actor.id && (input.active === false || input.role === "salesperson")) {
    throw new ValidationError("You cannot deactivate or demote your own account.");
  }

  return withTransaction(async (db) => {
    const current = await db.query<{ role: Role; is_active: boolean }>(
      `select role, is_active from crm.profiles where id = $1 for update`,
      [id],
    );
    const before = current.rows[0];
    if (!before) throw new NotFoundError("User");

    await db.query(
      `update crm.profiles set role = coalesce($2, role), is_active = coalesce($3, is_active) where id = $1`,
      [id, input.role ?? null, input.active ?? null],
    );
    if (input.role !== undefined && input.role !== before.role) {
      await recordAdminAudit(db, actor, "user.role_changed", "profile", id, { from: before.role, to: input.role });
    }
    if (input.active !== undefined && input.active !== before.is_active) {
      await recordAdminAudit(db, actor, input.active ? "user.reactivated" : "user.deactivated", "profile", id);
    }
    return (await getProfile(db, id))!;
  });
}
