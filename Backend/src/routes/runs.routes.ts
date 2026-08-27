import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../authMiddleware.js";
import { pool, withTransaction } from "../db.js";
import { parseBody, parseQuery } from "../validation/parse.js";
import { SCHEDULED_ACTION_STATUSES, WORKFLOW_RUN_STATUSES } from "../domain/enums.js";
import { ValidationError } from "../errors.js";
import * as runsService from "../services/runs.service.js";
import { autoEnroll } from "../services/runs.service.js";

export const runsRouter = Router();
runsRouter.use(requireAuth);

const listQuerySchema = z.object({
  workflowId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  status: z.enum(WORKFLOW_RUN_STATUSES).optional(),
});

runsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const filters = parseQuery(listQuerySchema, req.query);
    res.json({ data: await runsService.listRuns(pool, filters) });
  }),
);

const enrollSchema = z.object({ leadId: z.string().uuid(), reason: z.string().optional() });

/** Manual enrollment (product brief: workflow_trigger 'manual_enrollment'). */
runsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { leadId, reason } = parseBody(enrollSchema, req.body);
    const created = await withTransaction((client) =>
      autoEnroll(client, leadId, "manual_enrollment", reason ?? "Manually enrolled"),
    );
    if (created.length === 0) {
      throw new ValidationError("No active published workflow with trigger 'manual_enrollment' is available to enroll this lead in.");
    }
    res.status(201).json({ data: created });
  }),
);

const reasonSchema = z.object({ reason: z.string().optional() });

runsRouter.post(
  "/:id/pause",
  asyncHandler(async (req, res) => {
    const { reason } = parseBody(reasonSchema, req.body ?? {});
    res.json(await withTransaction((client) => runsService.pauseRun(client, req.actor!, req.params.id!, reason)));
  }),
);

runsRouter.post(
  "/:id/resume",
  asyncHandler(async (req, res) => {
    res.json(await withTransaction((client) => runsService.resumeRun(client, req.actor!, req.params.id!)));
  }),
);

runsRouter.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const { reason } = parseBody(reasonSchema, req.body ?? {});
    res.json(await withTransaction((client) => runsService.cancelRun(client, req.actor!, req.params.id!, reason)));
  }),
);

runsRouter.post(
  "/:id/retry",
  asyncHandler(async (req, res) => {
    res.json(await withTransaction((client) => runsService.retryRun(client, req.actor!, req.params.id!)));
  }),
);

// --- Scheduled actions (read/cancel only — no execution in this phase) -------

export const scheduledActionsRouter = Router();
scheduledActionsRouter.use(requireAuth);

const scheduledQuerySchema = z.object({
  leadId: z.string().uuid().optional(),
  workflowRunId: z.string().uuid().optional(),
  status: z.enum(SCHEDULED_ACTION_STATUSES).optional(),
});

scheduledActionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const filters = parseQuery(scheduledQuerySchema, req.query);
    res.json({ data: await runsService.listScheduledActions(pool, filters) });
  }),
);
