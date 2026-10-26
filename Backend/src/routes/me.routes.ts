import { Router } from "express";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, requireCrmUser, requireWorkspace } from "../authMiddleware.js";
import { pool } from "../db.js";
import { listProfiles } from "../services/profiles.service.js";

export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({
      id: req.actor!.id,
      name: req.actor!.fullName,
      email: req.actor!.email,
      role: req.actor!.role,
    });
  }),
);

// The owner picker: the people who can own a deal/task in the current workspace, derived from the
// workspace's platform project (owner + members). Needs the workspace header.
export const profilesRouter = Router();
profilesRouter.use(requireAuth, requireCrmUser, requireWorkspace);

profilesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ data: await listProfiles(pool, req.workspaceId!) });
  }),
);
