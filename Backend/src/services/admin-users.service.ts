import type { Actor } from "../authMiddleware.js";
import { pool, withTransaction } from "../db.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors.js";
import { supabaseAdmin } from "../supabaseAdmin.js";
import { recordAdminAudit } from "./admin-audit.service.js";

const LONG_BAN = "876000h";

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export async function listSalespeople() {
  const result = await pool.query<{
    id: string;
    full_name: string;
    email: string;
    initials: string;
    is_active: boolean;
    created_at: Date;
  }>(
    `select id, full_name, email, initials, is_active, created_at
       from public.profiles
      where role = 'salesperson'
      order by created_at desc`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.full_name,
    email: row.email,
    initials: row.initials,
    active: row.is_active,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function createSalesperson(actor: Actor, input: { name: string; email: string; password: string }) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: input.email.trim().toLowerCase(),
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.name.trim() },
  });
  if (error || !data.user) {
    throw new ConflictError(error?.message ?? "Unable to create the salesperson account.");
  }

  try {
    await withTransaction(async (db) => {
      await db.query(
        `update public.profiles
            set full_name = $2, email = $3, initials = $4, role = 'salesperson', is_active = true
          where id = $1`,
        [data.user.id, input.name.trim(), input.email.trim().toLowerCase(), initials(input.name)],
      );
      await recordAdminAudit(db, actor, "user.created", "profile", data.user.id, { email: input.email.trim().toLowerCase() });
    });
  } catch (error) {
    await supabaseAdmin.auth.admin.deleteUser(data.user.id).catch(() => undefined);
    throw error;
  }
  return (await listSalespeople()).find((user) => user.id === data.user.id)!;
}

export interface UpdateSalespersonInput {
  id: string;
  name?: string;
  email?: string;
  password?: string;
  active?: boolean;
}

export async function updateSalesperson(actor: Actor, input: UpdateSalespersonInput) {
  const existing = await pool.query<{ id: string; full_name: string; email: string; is_active: boolean }>(
    `select id, full_name, email, is_active from public.profiles where id = $1 and role = 'salesperson'`,
    [input.id],
  );
  const existingProfile = existing.rows[0];
  if (!existingProfile) throw new NotFoundError("Salesperson");
  if (input.password !== undefined && input.password.length < 12) {
    throw new ValidationError("Passwords must contain at least 12 characters.");
  }

  const authPatch: { email?: string; password?: string; ban_duration?: string; user_metadata?: Record<string, string> } = {};
  if (input.email !== undefined) authPatch.email = input.email.trim().toLowerCase();
  if (input.password !== undefined) authPatch.password = input.password;
  if (input.name !== undefined) authPatch.user_metadata = { full_name: input.name.trim() };
  if (input.active !== undefined) authPatch.ban_duration = input.active ? "none" : LONG_BAN;

  let authPatched = false;
  if (Object.keys(authPatch).length > 0) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(input.id, authPatch);
    if (error) throw new ConflictError(error.message);
    authPatched = true;
  }

  try {
    await withTransaction(async (db) => {
      await db.query(
        `update public.profiles
            set full_name = coalesce($2, full_name),
                email = coalesce($3, email),
                initials = case when $2::text is null then initials else $4 end,
                is_active = coalesce($5, is_active)
          where id = $1`,
        [
          input.id,
          input.name?.trim() ?? null,
          input.email?.trim().toLowerCase() ?? null,
          input.name ? initials(input.name) : null,
          input.active ?? null,
        ],
      );
      if (input.name !== undefined || input.email !== undefined) {
        await recordAdminAudit(db, actor, "user.profile_updated", "profile", input.id, {
          nameChanged: input.name !== undefined,
          emailChanged: input.email !== undefined,
        });
      }
      if (input.password !== undefined) await recordAdminAudit(db, actor, "user.password_reset", "profile", input.id);
      if (input.active !== undefined) {
        await recordAdminAudit(db, actor, input.active ? "user.reactivated" : "user.deactivated", "profile", input.id);
      }
    });
  } catch (error) {
    // Best-effort compensation: put Supabase Auth back the way it was so it
    // doesn't drift from the (unchanged) profiles row. A password reset can't
    // be reverted since the prior password isn't known, but email and ban
    // state can be, which covers the reactivate/deactivate and email-change cases.
    if (authPatched) {
      const revert: { email?: string; ban_duration?: string } = {};
      if (input.email !== undefined) revert.email = existingProfile.email;
      if (input.active !== undefined) revert.ban_duration = existingProfile.is_active ? "none" : LONG_BAN;
      if (Object.keys(revert).length > 0) {
        await supabaseAdmin.auth.admin.updateUserById(input.id, revert).catch(() => undefined);
      }
    }
    throw error;
  }
  return (await listSalespeople()).find((user) => user.id === input.id)!;
}
