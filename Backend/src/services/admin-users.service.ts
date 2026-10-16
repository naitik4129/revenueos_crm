import type { Actor } from "../authMiddleware.js";
import { pool, withTransaction } from "../db.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors.js";
import { supabaseAdmin } from "../supabaseAdmin.js";
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
  name?: string;
  password?: string;
  role?: Role;
}

/**
 * Gives a person CRM access. If they already have a shared Supabase account (platform or
 * brain user) we only add the crm.profiles row. Otherwise the account is created through
 * Supabase Auth admin; the platform's own trigger then creates its revenueos_profiles row.
 */
export async function createUser(actor: Actor, input: CreateUserInput) {
  const email = input.email.trim().toLowerCase();
  const role = input.role ?? "salesperson";

  const existing = await pool.query<{ id: string }>(
    `select id from public.revenueos_profiles where lower(email) = $1`,
    [email],
  );
  let userId = existing.rows[0]?.id;
  let createdAuthUser = false;

  if (!userId) {
    if (!input.password || input.password.length < 12) {
      throw new ValidationError("A password of at least 12 characters is required for a new account.", { field: "password" });
    }
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
      user_metadata: input.name?.trim() ? { full_name: input.name.trim() } : {},
    });
    if (error || !data.user) {
      throw new ConflictError(error?.message ?? "Unable to create the account.");
    }
    userId = data.user.id;
    createdAuthUser = true;
  }

  const id = userId;
  try {
    await withTransaction(async (db) => {
      const inserted = await db.query(
        `insert into crm.profiles (id, role) values ($1, $2) on conflict (id) do nothing returning id`,
        [id, role],
      );
      if (!inserted.rows[0]) throw new ConflictError("This person already has CRM access.", { field: "email" });
      await recordAdminAudit(db, actor, "user.created", "profile", id, { email, role, newAccount: createdAuthUser });
    });
  } catch (error) {
    // Only undo an account we just created; never delete a pre-existing shared account.
    if (createdAuthUser) await supabaseAdmin.auth.admin.deleteUser(id).catch(() => undefined);
    throw error;
  }
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
