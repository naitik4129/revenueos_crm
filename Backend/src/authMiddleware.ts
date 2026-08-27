import type { NextFunction, Request, Response } from "express";
import { pool } from "./db.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { AuthenticationError, ForbiddenError } from "./errors.js";
import { asyncHandler } from "./asyncHandler.js";

/** The authenticated CRM actor (salesperson) for the lifetime of one request. */
export interface Actor {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
}

declare module "express-serve-static-core" {
  interface Request {
    actor?: Actor;
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
  }>(`select id, full_name, email, is_active from public.profiles where id = $1`, [data.user.id]);

  const profile = result.rows[0];
  if (!profile) {
    throw new AuthenticationError("No CRM profile for this account.");
  }
  if (!profile.is_active) {
    throw new ForbiddenError("This salesperson account has been deactivated.");
  }

  req.actor = {
    id: profile.id,
    fullName: profile.full_name,
    email: profile.email,
    isActive: profile.is_active,
  };
  next();
});
