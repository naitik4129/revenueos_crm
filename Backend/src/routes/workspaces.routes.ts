import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAdmin, requireAuth, requireCrmUser } from "../authMiddleware.js";
import { parseBody, parseParams } from "../validation/parse.js";
import * as workspacesService from "../services/workspaces.service.js";
import * as brainKeys from "../services/brain-keys.service.js";

/**
 * Not gated by requireWorkspace: the list must load before a workspace is selected.
 * Any CRM user can list (admins get all, salespeople their memberships); only admins
 * create/edit workspaces and assign members.
 */
export const workspacesRouter = Router();
workspacesRouter.use(requireAuth, requireCrmUser);

workspacesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ data: await workspacesService.listWorkspaces(req.actor!) });
  }),
);

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1),
  platformProjectId: z.string().uuid().nullable().optional(),
});

workspacesRouter.post(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = parseBody(createWorkspaceSchema, req.body);
    res.status(201).json(await workspacesService.createWorkspace(req.actor!, input));
  }),
);

const workspaceIdParamsSchema = z.object({ id: z.string().uuid() });
const updateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    isActive: z.boolean().optional(),
    platformProjectId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

workspacesRouter.patch(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(workspaceIdParamsSchema, req.params);
    const input = parseBody(updateWorkspaceSchema, req.body);
    res.json(await workspacesService.updateWorkspace(req.actor!, id, input));
  }),
);

workspacesRouter.get(
  "/:id/members",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(workspaceIdParamsSchema, req.params);
    res.json({ data: await workspacesService.listMembers(id) });
  }),
);

const setMembersSchema = z.object({ userIds: z.array(z.string().uuid()).max(500) });

workspacesRouter.put(
  "/:id/members",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(workspaceIdParamsSchema, req.params);
    const { userIds } = parseBody(setMembersSchema, req.body);
    res.json({ data: await workspacesService.setMembers(req.actor!, id, userIds) });
  }),
);

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
