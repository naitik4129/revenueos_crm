import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { pool, withTransaction } from "../db.js";
import { AppError, AuthenticationError } from "../errors.js";
import { createFixedWindowLimiter, ingestKeysMatch } from "../security/ingestGuard.js";
import { ingestWebsiteLead } from "../services/leadIngest.service.js";
import { parseBody } from "../validation/parse.js";

const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_FIELD_CHARS = 20_000;

// Lenient on purpose: the website is the only caller and a lead must not be
// lost to a type quirk. The body only has to be a JSON object; each field is
// coerced by toText (numbers such as an unquoted phone are stringified,
// anything else non-string is treated as empty, over-long text is cut here and
// cleaned further by the normalizer) and unknown keys are ignored.
const websiteFormSchema = z.object({
  name: z.unknown(),
  email: z.unknown(),
  phone: z.unknown(),
  company: z.unknown(),
  message: z.unknown(),
});

function toText(value: unknown): string | null {
  if (typeof value === "string") return value.slice(0, MAX_FIELD_CHARS);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * Public (no Supabase login) endpoint the marketing website's server calls to
 * turn a contact-form submission into a CRM lead. Mounted only when
 * INGEST_API_KEY / INGEST_WORKSPACE_ID are configured (routes/index.ts), so
 * with those unset this route does not exist. Authentication is a shared
 * secret in `X-Ingest-Key`; the key is bound to exactly one workspace.
 */
export function createPublicLeadsRouter(config: { apiKey: string; workspaceId: string }) {
  const router = Router();
  const limiter = createFixedWindowLimiter({ max: 60, windowMs: 60_000 });

  function requireIngestKey(req: Request, _res: Response, next: NextFunction) {
    if (!ingestKeysMatch(req.header("x-ingest-key"), config.apiKey)) {
      next(new AuthenticationError("Invalid or missing ingest key."));
      return;
    }
    next();
  }

  function rateLimit(_req: Request, res: Response, next: NextFunction) {
    const retryAfter = limiter.check();
    if (retryAfter > 0) {
      res.setHeader("Retry-After", String(retryAfter));
      next(new AppError(429, "rate_limited", "Too many requests."));
      return;
    }
    next();
  }

  function limitSize(req: Request, _res: Response, next: NextFunction) {
    const declared = Number(req.header("content-length") ?? 0);
    if (declared > MAX_REQUEST_BYTES) {
      next(new AppError(413, "payload_too_large", "Request body is too large."));
      return;
    }
    next();
  }

  router.post(
    "/leads",
    requireIngestKey,
    rateLimit,
    limitSize,
    asyncHandler(async (req, res) => {
      const body = parseBody(websiteFormSchema, req.body ?? {});
      const input = {
        name: toText(body.name),
        email: toText(body.email),
        phone: toText(body.phone),
        company: toText(body.company),
        message: toText(body.message),
      };

      const workspace = await pool.query(`select 1 from public.workspaces where id = $1 and is_active = true`, [config.workspaceId]);
      if (!workspace.rowCount) {
        throw new AppError(503, "workspace_unavailable", "The target workspace is not available.");
      }

      const outcome = await withTransaction((client) => ingestWebsiteLead(client, config.workspaceId, input));
      console.log(JSON.stringify({ event: "website_lead_ingest", status: outcome.status, leadId: "leadId" in outcome ? outcome.leadId : undefined }));

      if (outcome.status === "rejected") {
        throw new AppError(422, "unusable_submission", outcome.reason);
      }
      res.status(outcome.status === "created" ? 201 : 200).json({ data: { status: outcome.status, leadId: outcome.leadId } });
    }),
  );

  return router;
}
