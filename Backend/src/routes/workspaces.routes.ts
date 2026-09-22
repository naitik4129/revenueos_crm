import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, requireSalesperson } from "../authMiddleware.js";
import { parseBody, parseParams } from "../validation/parse.js";
import * as workspacesService from "../services/workspaces.service.js";

/**
 * Deliberately NOT gated by requireWorkspace: a workspace must be listable
 * (and creatable) before the frontend has one selected to send as
 * X-Workspace-Id. Any active salesperson can list/create/rename workspaces —
 * see the multi-workspace architecture plan: there is no per-workspace
 * membership, and workspace administration is intentionally NOT limited to
 * the admin role (Admin stays scoped to user management only).
 */
export const workspacesRouter = Router();
workspacesRouter.use(requireAuth, requireSalesperson);

workspacesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({ data: await workspacesService.listWorkspaces() });
  }),
);

const createWorkspaceSchema = z.object({ name: z.string().min(1) });

workspacesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parseBody(createWorkspaceSchema, req.body);
    const workspace = await workspacesService.createWorkspace(req.actor!, input);
    res.status(201).json(workspace);
  }),
);

const workspaceIdParamsSchema = z.object({ id: z.string().uuid() });
const renameWorkspaceSchema = z.object({ name: z.string().min(1) });

workspacesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = parseParams(workspaceIdParamsSchema, req.params);
    const input = parseBody(renameWorkspaceSchema, req.body);
    res.json(await workspacesService.renameWorkspace(req.actor!, id, input));
  }),
);
