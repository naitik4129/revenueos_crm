import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireServiceAuth } from "../serviceAuthMiddleware.js";
import { pool, withTransaction } from "../db.js";
import { parseBody, parseQuery } from "../validation/parse.js";
import * as automationService from "../services/automation.service.js";

/**
 * The ONLY routes n8n calls. Protected by requireServiceAuth (a shared
 * secret, see serviceAuthMiddleware.ts) — completely separate from
 * requireAuth's salesperson/Supabase-session trust boundary used by every
 * other router. Nothing here accepts or needs a salesperson token, and
 * nothing outside this router accepts the automation key.
 *
 * This is intentionally the full extent of what n8n can do: claim work,
 * read one action's current context, report a result, execute a backend-
 * owned internal action, or forward a normalized inbound event. All
 * business logic (what a step means, next-step selection, retry/backoff,
 * eligibility) lives in automation.service.ts — see n8n/README.md.
 */
export const automationRouter = Router();
automationRouter.use(requireServiceAuth);

const claimSchema = z.object({ limit: z.number().int().min(1).max(100).optional() });

automationRouter.post(
  "/due-actions/claim",
  asyncHandler(async (req, res) => {
    const { limit } = parseBody(claimSchema, req.body ?? {});
    const claimed = await withTransaction((client) => automationService.claimDueActions(client, limit ?? 20));
    res.json({ data: claimed });
  }),
);

automationRouter.get(
  "/actions/:id/context",
  asyncHandler(async (req, res) => {
    res.json(await automationService.getActionContext(pool, req.params.id!));
  }),
);

const skipSchema = z.object({ reason: z.string().min(1) });

automationRouter.post(
  "/actions/:id/skip",
  asyncHandler(async (req, res) => {
    const { reason } = parseBody(skipSchema, req.body);
    res.json(await withTransaction((client) => automationService.skipAction(client, req.params.id!, reason)));
  }),
);

automationRouter.post(
  "/actions/:id/execute-internal",
  asyncHandler(async (req, res) => {
    res.json(await withTransaction((client) => automationService.executeInternalAction(client, req.params.id!)));
  }),
);

const resultSchema = z.object({
  outcome: z.enum(["success", "failure"]),
  providerMessageId: z.string().optional(),
  providerResponse: z.unknown().optional(),
  error: z.string().optional(),
  retryable: z.boolean().optional(),
});

automationRouter.post(
  "/actions/:id/result",
  asyncHandler(async (req, res) => {
    const input = parseBody(resultSchema, req.body);
    res.json(await withTransaction((client) => automationService.recordActionResult(client, req.params.id!, input)));
  }),
);

const lookupQuerySchema = z.object({ email: z.string().optional(), phone: z.string().optional() });

automationRouter.get(
  "/leads/lookup",
  asyncHandler(async (req, res) => {
    const { email, phone } = parseQuery(lookupQuerySchema, req.query);
    res.json({ data: await automationService.lookupLeadByContact(pool, { email, phone }) });
  }),
);

const inboundEventSchema = z.object({
  leadId: z.string().uuid(),
  channel: z.enum(["email", "whatsapp"]),
  providerMessageId: z.string().optional(),
  occurredAt: z.string().datetime().optional(),
  summary: z.string().min(1),
});

automationRouter.post(
  "/inbound-events",
  asyncHandler(async (req, res) => {
    const input = parseBody(inboundEventSchema, req.body);
    res.json(await withTransaction((client) => automationService.recordInboundEvent(client, input)));
  }),
);
