import { Router } from "express";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../authMiddleware.js";
import { pool } from "../db.js";
import { listProfiles } from "../services/profiles.service.js";

export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ id: req.actor!.id, name: req.actor!.fullName, email: req.actor!.email });
  }),
);

export const profilesRouter = Router();
profilesRouter.use(requireAuth);

profilesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({ data: await listProfiles(pool) });
  }),
);
