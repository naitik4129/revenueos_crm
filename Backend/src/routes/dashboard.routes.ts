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
    const [summary, queue] = await Promise.all([
      getDashboardSummary(pool, req.workspaceId!),
      listTodaysQueue(pool, req.workspaceId!),
    ]);
    res.json({ ...summary, todaysQueue: queue });
  }),
);
