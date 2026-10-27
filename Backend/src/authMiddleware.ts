import type { NextFunction, Request, Response } from "express";
import { pool } from "./db.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { AuthenticationError, ForbiddenError, NotFoundError } from "./errors.js";
import { asyncHandler } from "./asyncHandler.js";
import { resolveActor } from "./services/profiles.service.js";
import { ownsOrMemberOfProjectSql } from "./services/platform-sync.service.js";

/** The authenticated CRM user (admin, salesperson, or read-only client) for one request. */
export interface Actor {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  role: "admin" | "salesperson" | "client";
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
 *  2. Resolve CRM access from the platform (resolveActor): an admin is a crm_profiles row; everyone
 *     else gets salesperson access if they own or belong to any platform project. No access → 403,
 *     and a deactivated crm_profiles row → 403.
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

  const resolved = await resolveActor(pool, data.user.id);
  if (resolved.status === "deactivated") {
    throw new ForbiddenError("This account has been deactivated.");
  }
  if (resolved.status !== "ok") {
    throw new ForbiddenError("This account has no CRM access.");
  }

  req.actor = resolved.actor;
  next();
});

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.actor?.role !== "admin") {
    next(new ForbiddenError("Administrator access is required."));
    return;
  }
  next();
}

/**
 * Any CRM user: admins see and edit everything, salespeople are limited by requireWorkspace, and
 * clients are additionally read-only (requireWritable). All three may reach read (GET) routes.
 */
export function requireCrmUser(req: Request, _res: Response, next: NextFunction) {
  const role = req.actor?.role;
  if (role !== "admin" && role !== "salesperson" && role !== "client") {
    next(new ForbiddenError("CRM access is required."));
    return;
  }
  next();
}

/**
 * Blocks writes for a read-only client account: a client may only make safe (read) requests. Runs
 * after requireAuth. This is the real read-only boundary — the frontend hiding controls is only UX.
 */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export function requireWritable(req: Request, _res: Response, next: NextFunction) {
  if (req.actor?.role === "client" && !READ_METHODS.has(req.method)) {
    next(new ForbiddenError("This is a read-only (client) account."));
    return;
  }
  next();
}

/**
 * Resolves the workspace from the `X-Workspace-Id` header. It must be active.
 * Admins may use any workspace; everyone else only those whose platform project they own or are a
 * member of (revenueos_project_members). Must run after requireAuth + requireCrmUser.
 */
export const requireWorkspace = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.header("x-workspace-id");
  if (!header || !UUID_RE.test(header)) {
    throw new NotFoundError("Workspace");
  }
  // Access comes from the platform project (owner or member). crm_workspace_members is kept only as
  // a secondary path for legacy rows; nothing writes it any more, so it is empty in production.
  const result = await pool.query<{ id: string; has_access: boolean }>(
    `select w.id,
            ((w.platform_project_id is not null and ${ownsOrMemberOfProjectSql("w.platform_project_id", "$2")})
             or exists (select 1 from crm_workspace_members m where m.workspace_id = w.id and m.user_id = $2)) as has_access
       from crm_workspaces w
      where w.id = $1 and w.is_active = true`,
    [header, req.actor!.id],
  );
  const workspace = result.rows[0];
  if (!workspace) {
    throw new NotFoundError("Workspace");
  }
  if (req.actor!.role !== "admin" && !workspace.has_access) {
    throw new ForbiddenError("You do not have access to this workspace.");
  }
  req.workspaceId = workspace.id;
  next();
});
