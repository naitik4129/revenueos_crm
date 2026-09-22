import type { NextFunction, Request, Response } from "express";
import { pool } from "./db.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { AuthenticationError, ForbiddenError, NotFoundError } from "./errors.js";
import { asyncHandler } from "./asyncHandler.js";

/** The authenticated CRM actor (salesperson) for the lifetime of one request. */
export interface Actor {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  role: "admin" | "salesperson";
}

declare module "express-serve-static-core" {
  interface Request {
    actor?: Actor;
    workspaceId?: string;
  }
}

/**
 * Establishes the authenticated salesperson for a request:
 *  1. Verify the bearer token against Supabase Auth (proves the caller owns
 *     a real session issued by our auth foundation — we never trust a
 *     client-supplied user id).
 *  2. Load the matching CRM profile and require is_active — a disabled
 *     salesperson's token must not grant CRM access, even if it's still a
 *     technically-valid Supabase session (Rule: security-sensitive data
 *     must never be trusted merely because the browser sent it).
 *
 * On success, req.actor is populated and every downstream handler/service
 * uses it for ownership/attribution — never a client-supplied "userId".
 */
export const requireAuth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  if (req.actor) {
    next();
    return;
  }

  const header = req.header("authorization") ?? req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined;
  if (!token) {
    throw new AuthenticationError("Missing bearer token.");
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    throw new AuthenticationError("Invalid or expired session.");
  }

  const result = await pool.query<{
    id: string;
    full_name: string;
    email: string;
    is_active: boolean;
    role: "admin" | "salesperson";
  }>(`select id, full_name, email, is_active, role from public.profiles where id = $1`, [data.user.id]);

  const profile = result.rows[0];
  if (!profile) {
    throw new AuthenticationError("No CRM profile for this account.");
  }
  if (!profile.is_active) {
    throw new ForbiddenError("This account has been deactivated.");
  }

  req.actor = {
    id: profile.id,
    fullName: profile.full_name,
    email: profile.email,
    isActive: profile.is_active,
    role: profile.role,
  };
  next();
});

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.actor?.role !== "admin") {
    next(new ForbiddenError("Administrator access is required."));
    return;
  }
  next();
}

export function requireSalesperson(req: Request, _res: Response, next: NextFunction) {
  if (req.actor?.role !== "salesperson") {
    next(new ForbiddenError("Administrator accounts cannot access CRM business routes."));
    return;
  }
  next();
}

/**
 * Resolves the workspace a CRM request is operating in from the
 * `X-Workspace-Id` header the frontend attaches to every request (see
 * Frontend/src/lib/backend-client.ts). Any active salesperson may address
 * any active workspace — there is no per-user workspace membership (see the
 * multi-workspace architecture plan) — so this only validates that the
 * header names a real, active workspace; it is not an authorization check
 * beyond that. Must run after requireAuth + requireSalesperson.
 */
export const requireWorkspace = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.header("x-workspace-id");
  if (!header) {
    throw new NotFoundError("Workspace");
  }
  const result = await pool.query<{ id: string }>(
    `select id from public.workspaces where id = $1 and is_active = true`,
    [header],
  );
  if (!result.rows[0]) {
    throw new NotFoundError("Workspace");
  }
  req.workspaceId = result.rows[0].id;
  next();
});
