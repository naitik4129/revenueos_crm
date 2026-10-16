import { Router } from "express";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../authMiddleware.js";
import { pool } from "../db.js";
import { getDashboardSummary } from "../services/dashboard.service.js";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    res.json(await getDashboardSummary(pool, req.workspaceId!));
  }),
);
