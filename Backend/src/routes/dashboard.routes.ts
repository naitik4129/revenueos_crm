import { Router } from "express";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../authMiddleware.js";
import { pool } from "../db.js";
import { getDashboardSummary, listTodaysQueue } from "../services/dashboard.service.js";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const summary = await getDashboardSummary(pool, req.workspaceId!);
    res.json({ ...summary, todaysQueue: await listTodaysQueue(pool, req.workspaceId!, req.actor!.id) });
  }),
);
