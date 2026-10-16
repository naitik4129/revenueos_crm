import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { pool, withTransaction } from "../db.js";
import { parseBody, parseId, parseQuery } from "../validation/parse.js";
import { AUTOMATION_MODES, DEAL_OUTCOMES, LEAD_LOSS_REASONS, PIPELINE_STAGES, RESPONSE_STATES } from "../domain/enums.js";
import * as deals from "../services/deals.service.js";
import { dealToDto } from "../services/deals.service.js";
import { listTimeline } from "../services/timeline.service.js";

/** Mounted under the workspace-gated crmRouter (routes/index.ts). */
export const dealsRouter = Router();

const id = (req: { params: Record<string, string | undefined> }) => parseId(req.params.id, "Deal");
const page = { limit: z.coerce.number().int().positive().max(500).optional(), offset: z.coerce.number().int().min(0).optional() };

dealsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = parseQuery(
      z.object({
        outcome: z.enum(DEAL_OUTCOMES).optional(),
        stage: z.enum(PIPELINE_STAGES).optional(),
        ownerId: z.string().uuid().optional(),
        automationMode: z.enum(AUTOMATION_MODES).optional(),
        contactId: z.string().uuid().optional(),
        companyId: z.string().uuid().optional(),
        missingNextAction: z.enum(["true", "false"]).optional(),
        search: z.string().optional(),
        ...page,
      }),
      req.query,
    );
    res.json(await deals.listDeals(pool, req.workspaceId!, { ...q, missingNextAction: q.missingNextAction === "true" }));
  }),
);

dealsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parseBody(
      z.object({
        contactId: z.string().uuid(),
        ownerId: z.string().uuid().nullable().optional(),
        stage: z.enum(PIPELINE_STAGES).optional(),
        serviceInterest: z.string().optional(),
      }),
      req.body,
    );
    const row = await withTransaction((db) => deals.createDeal(db, req.actor!, req.workspaceId!, input));
    res.status(201).json(dealToDto(row));
  }),
);

dealsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(dealToDto(await deals.getDealOr404(pool, req.workspaceId!, id(req))));
  }),
);

dealsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const patch = parseBody(
      z.object({
        ownerId: z.string().uuid().nullable().optional(),
        stage: z.enum(PIPELINE_STAGES).optional(),
        responseState: z.enum(RESPONSE_STATES).optional(),
        serviceInterest: z.string().optional(),
      }),
      req.body,
    );
    res.json(dealToDto(await withTransaction((db) => deals.updateDeal(db, req.actor!, req.workspaceId!, id(req), patch))));
  }),
);

dealsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await withTransaction((db) => deals.deleteDeal(db, req.actor!, req.workspaceId!, id(req)));
    res.status(204).send();
  }),
);

dealsRouter.post(
  "/:id/automation",
  asyncHandler(async (req, res) => {
    const { mode, reason } = parseBody(z.object({ mode: z.enum(AUTOMATION_MODES), reason: z.string().optional() }), req.body);
    res.json(dealToDto(await withTransaction((db) => deals.setAutomationMode(db, req.actor!, req.workspaceId!, id(req), mode, reason))));
  }),
);

// --- Outcome ----------------------------------------------------------------------------

const optionalReason = z.object({ reason: z.string().optional() });

const outcomeRoutes = {
  won: deals.markWon,
  discard: deals.markDiscarded,
  nurture: deals.moveToNurture,
  reopen: deals.reopenDeal,
} as const;

for (const [path, action] of Object.entries(outcomeRoutes)) {
  dealsRouter.post(
    `/:id/${path}`,
    asyncHandler(async (req, res) => {
      const { reason } = parseBody(optionalReason, req.body);
      res.json(dealToDto(await withTransaction((db) => action(db, req.actor!, req.workspaceId!, id(req), reason))));
    }),
  );
}

dealsRouter.post(
  "/:id/lost",
  asyncHandler(async (req, res) => {
    const { lossReason, notes } = parseBody(z.object({ lossReason: z.enum(LEAD_LOSS_REASONS), notes: z.string().optional() }), req.body);
    res.json(dealToDto(await withTransaction((db) => deals.markLost(db, req.actor!, req.workspaceId!, id(req), lossReason, notes))));
  }),
);

dealsRouter.get(
  "/:id/timeline",
  asyncHandler(async (req, res) => {
    const dealId = (await deals.getDealOr404(pool, req.workspaceId!, id(req))).id;
    res.json({ data: await listTimeline(pool, req.workspaceId!, { ...parseQuery(z.object(page), req.query), dealId }) });
  }),
);
