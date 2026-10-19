import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { pool, withTransaction } from "../db.js";
import { parseBody, parseId, parseQuery } from "../validation/parse.js";
import { SCHEDULED_ACTION_STATUSES, WORKFLOW_RUN_STATUSES } from "../domain/enums.js";
import { ValidationError } from "../errors.js";
import * as runsService from "../services/runs.service.js";
import { autoEnroll, enrollDealInWorkflow } from "../services/runs.service.js";

export const runsRouter = Router();

const page = { limit: z.coerce.number().int().positive().max(500).optional(), offset: z.coerce.number().int().min(0).optional() };

const listQuerySchema = z.object({
  workflowId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  status: z.enum(WORKFLOW_RUN_STATUSES).optional(),
  search: z.string().trim().min(1).optional(),
  ...page,
});

runsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { limit = 50, offset = 0, ...filters } = parseQuery(listQuerySchema, req.query);
    const [list, statusCounts] = await Promise.all([
      runsService.listRuns(pool, req.workspaceId!, filters, { limit, offset }),
      runsService.runStatusCounts(pool, req.workspaceId!, filters),
    ]);
    res.json({ ...list, statusCounts, limit, offset });
  }),
);

const enrollSchema = z.object({ dealId: z.string().uuid(), workflowId: z.string().uuid().optional(), reason: z.string().optional() });

/**
 * Manual enrollment. With `workflowId`, enrolls the lead in exactly that
 * workflow (any trigger — a salesperson's explicit choice). Without it,
 * falls back to the product brief's 'manual_enrollment' trigger lookup for
 * backward compatibility.
 */
runsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { dealId, workflowId, reason } = parseBody(enrollSchema, req.body);
    const enrolledReason = reason ?? "Manually enrolled";

    if (workflowId) {
      const run = await withTransaction((client) => enrollDealInWorkflow(client, req.workspaceId!, dealId, workflowId, enrolledReason));
      if (!run) {
        throw new ValidationError("This deal already has an active run for that workflow.");
      }
      res.status(201).json({ data: [run] });
      return;
    }

    const created = await withTransaction((client) => autoEnroll(client, req.workspaceId!, dealId, "manual_enrollment", enrolledReason));
    if (created.length === 0) {
      throw new ValidationError("No active published workflow with trigger 'manual_enrollment' is available to enroll this deal in.");
    }
    res.status(201).json({ data: created });
  }),
);

const reasonSchema = z.object({ reason: z.string().optional() });

runsRouter.post(
  "/:id/pause",
  asyncHandler(async (req, res) => {
    const { reason } = parseBody(reasonSchema, req.body ?? {});
    res.json(await withTransaction((client) => runsService.pauseRun(client, req.actor!, req.workspaceId!, parseId(req.params.id, "Workflow run"), reason)));
  }),
);

runsRouter.post(
  "/:id/resume",
  asyncHandler(async (req, res) => {
    res.json(await withTransaction((client) => runsService.resumeRun(client, req.actor!, req.workspaceId!, parseId(req.params.id, "Workflow run"))));
  }),
);

runsRouter.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const { reason } = parseBody(reasonSchema, req.body ?? {});
    res.json(await withTransaction((client) => runsService.cancelRun(client, req.actor!, req.workspaceId!, parseId(req.params.id, "Workflow run"), reason)));
  }),
);

runsRouter.post(
  "/:id/retry",
  asyncHandler(async (req, res) => {
    res.json(await withTransaction((client) => runsService.retryRun(client, req.actor!, req.workspaceId!, parseId(req.params.id, "Workflow run"))));
  }),
);

// --- Scheduled actions (read/cancel only — no execution in this phase) -------

export const scheduledActionsRouter = Router();

const scheduledQuerySchema = z.object({
  dealId: z.string().uuid().optional(),
  workflowRunId: z.string().uuid().optional(),
  status: z.enum(SCHEDULED_ACTION_STATUSES).optional(),
  search: z.string().trim().min(1).optional(),
  ...page,
});

scheduledActionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { limit = 50, offset = 0, ...filters } = parseQuery(scheduledQuerySchema, req.query);
    res.json({ ...(await runsService.listScheduledActions(pool, req.workspaceId!, filters, { limit, offset })), limit, offset });
  }),
);
