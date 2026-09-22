import { Router } from "express";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../authMiddleware.js";
import { pool, withTransaction } from "../db.js";
import { listNotificationsFor, markAllNotificationsRead, markNotificationRead } from "../services/notifications.service.js";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ data: await listNotificationsFor(pool, req.actor!.id, req.workspaceId!) });
  }),
);

notificationsRouter.post(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const notification = await withTransaction((client) => markNotificationRead(client, req.actor!.id, req.workspaceId!, req.params.id!));
    res.json(notification);
  }),
);

notificationsRouter.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    const data = await withTransaction((client) => markAllNotificationsRead(client, req.actor!.id, req.workspaceId!));
    res.json({ data });
  }),
);
