import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { pool, withTransaction } from "../db.js";
import { parseBody, parseId, parseQuery } from "../validation/parse.js";
import { LEAD_LOSS_REASONS, PROPOSAL_STATUSES } from "../domain/enums.js";
import { createProposal, getProposalOr404, listProposals, updateProposal, updateProposalStatus } from "../services/proposals.service.js";

/**
 * Mounted under the workspace-gated crmRouter (routes/index.ts). Proposals are created as
 * drafts here; uploading the document and sending it by email/WhatsApp comes back in P5.
 */
export const proposalsRouter = Router();

const id = (req: { params: Record<string, string | undefined> }) => parseId(req.params.id, "Proposal");

proposalsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = parseQuery(
      z.object({ dealId: z.string().uuid().optional(), status: z.enum(PROPOSAL_STATUSES).optional(), ownerId: z.string().uuid().optional() }),
      req.query,
    );
    res.json({ data: await listProposals(pool, req.workspaceId!, q) });
  }),
);

const createSchema = z.object({
  dealId: z.string().uuid(),
  title: z.string().min(1),
  amount: z.number().nonnegative().optional(),
  currency: z.string().trim().length(3).optional(),
  notes: z.string().optional(),
});

proposalsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parseBody(createSchema, req.body);
    res.status(201).json(await withTransaction((db) => createProposal(db, req.actor!, req.workspaceId!, input)));
  }),
);

proposalsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await getProposalOr404(pool, req.workspaceId!, id(req)));
  }),
);

proposalsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const patch = parseBody(z.object({ title: z.string().min(1).optional(), amount: z.number().nonnegative().optional(), notes: z.string().optional() }), req.body);
    res.json(await withTransaction((db) => updateProposal(db, req.workspaceId!, id(req), patch)));
  }),
);

// lossReason is required (by the service) only for rejected/expired.
const statusSchema = z.object({
  status: z.enum(PROPOSAL_STATUSES),
  lossReason: z.enum(LEAD_LOSS_REASONS).optional(),
  lossNotes: z.string().optional(),
});

proposalsRouter.post(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const { status, lossReason, lossNotes } = parseBody(statusSchema, req.body);
    res.json(await withTransaction((db) => updateProposalStatus(db, req.actor!, req.workspaceId!, id(req), status, { lossReason, lossNotes })));
  }),
);
