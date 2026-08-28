import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { AuthenticationError } from "./errors.js";
import { asyncHandler } from "./asyncHandler.js";
import { env } from "./env.js";

/**
 * Machine-to-machine authentication for the automation executor (n8n), kept
 * entirely separate from salesperson authentication (authMiddleware.ts).
 *
 * n8n is not a salesperson: it has no Supabase Auth session and must never
 * be issued one. It authenticates with a single long-lived shared secret
 * (N8N_SERVICE_API_KEY) sent as `X-Automation-Key`, checked with a
 * constant-time comparison so response timing can't leak the secret. This
 * key only unlocks the routes mounted under /api/v1/automation — it grants
 * no access to any salesperson-facing route, and requireAuth is completely
 * unaffected by this file.
 */
export const requireServiceAuth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  if (!env.N8N_SERVICE_API_KEY) {
    // Not configured — this deployment doesn't use an external automation
    // executor (the in-process worker, src/worker.ts, is the primary one).
    // Reject rather than throw on a missing Buffer input below.
    throw new AuthenticationError("The automation service key is not configured on this deployment.");
  }

  const provided = req.header("x-automation-key");
  if (!provided) {
    throw new AuthenticationError("Missing X-Automation-Key header.");
  }

  const expected = Buffer.from(env.N8N_SERVICE_API_KEY);
  const actual = Buffer.from(provided);
  const valid = expected.length === actual.length && timingSafeEqual(expected, actual);
  if (!valid) {
    throw new AuthenticationError("Invalid automation service key.");
  }

  next();
});
