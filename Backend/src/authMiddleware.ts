import type { NextFunction, Request, Response } from "express";
import { pool } from "./db.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { AuthenticationError, ForbiddenError, NotFoundError } from "./errors.js";
import { asyncHandler } from "./asyncHandler.js";
import { getProfile } from "./services/profiles.service.js";

/** The authenticated CRM user (admin or salesperson) for the lifetime of one request. */
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Establishes the CRM user for a request:
 *  1. Verify the bearer token against the shared Supabase Auth (never trust a
 *     client-supplied user id).
 *  2. Require an active crm.profiles row. A valid platform/brain account without
 *     one has no CRM access (403), and neither has a deactivated one.
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

  const profile = await getProfile(pool, data.user.id);
  if (!profile) {
    throw new ForbiddenError("This account has no CRM access.");
  }
  if (!profile.active) {
    throw new ForbiddenError("This account has been deactivated.");
  }

  req.actor = {
    id: profile.id,
    fullName: profile.name,
    email: profile.email,
    isActive: profile.active,
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

/** Any CRM user: admins see and edit everything, salespeople are limited by requireWorkspace. */
export function requireCrmUser(req: Request, _res: Response, next: NextFunction) {
  if (req.actor?.role !== "admin" && req.actor?.role !== "salesperson") {
    next(new ForbiddenError("CRM access is required."));
    return;
  }
  next();
}

/**
 * Resolves the workspace from the `X-Workspace-Id` header. It must be active.
 * Admins may use any workspace; salespeople only those they are members of.
 * Must run after requireAuth + requireCrmUser.
 */
export const requireWorkspace = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.header("x-workspace-id");
  if (!header || !UUID_RE.test(header)) {
    throw new NotFoundError("Workspace");
  }
  const result = await pool.query<{ id: string; is_member: boolean }>(
    `select w.id,
            exists (select 1 from crm.workspace_members m where m.workspace_id = w.id and m.user_id = $2) as is_member
       from crm.workspaces w
      where w.id = $1 and w.is_active = true`,
    [header, req.actor!.id],
  );
  const workspace = result.rows[0];
  if (!workspace) {
    throw new NotFoundError("Workspace");
  }
  if (req.actor!.role !== "admin" && !workspace.is_member) {
    throw new ForbiddenError("You are not a member of this workspace.");
  }
  req.workspaceId = workspace.id;
  next();
});
