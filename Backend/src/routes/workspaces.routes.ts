import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAdmin, requireAuth, requireCrmUser } from "../authMiddleware.js";
import { parseBody, parseParams } from "../validation/parse.js";
import * as workspacesService from "../services/workspaces.service.js";
import * as brainKeys from "../services/brain-keys.service.js";

/**
 * Workspaces are derived from the RevenueOS platform and created automatically; they are not managed
 * here. Any CRM user lists them (admins: all; everyone else: their platform projects' workspaces).
 * Brain API keys stay here, admin only. Not gated by requireWorkspace: the list loads before a
 * workspace is selected.
 */
export const workspacesRouter = Router();
workspacesRouter.use(requireAuth, requireCrmUser);

workspacesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ data: await workspacesService.listWorkspaces(req.actor!) });
  }),
);

const workspaceIdParamsSchema = z.object({ id: z.string().uuid() });

// --- Brain API keys (admin only); the plain key is returned once, on create ---

workspacesRouter.get(
  "/:id/brain-keys",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(workspaceIdParamsSchema, req.params);
    res.json({ data: await brainKeys.listBrainKeys(id) });
  }),
);

workspacesRouter.post(
  "/:id/brain-keys",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(workspaceIdParamsSchema, req.params);
    const { label } = parseBody(z.object({ label: z.string().trim().min(1).max(100) }), req.body);
    res.status(201).json(await brainKeys.createBrainKey(req.actor!, id, label));
  }),
);

workspacesRouter.delete(
  "/:id/brain-keys/:keyId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id, keyId } = parseParams(z.object({ id: z.string().uuid(), keyId: z.string().uuid() }), req.params);
    res.json(await brainKeys.revokeBrainKey(req.actor!, id, keyId));
  }),
);
