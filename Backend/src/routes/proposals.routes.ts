import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../authMiddleware.js";
import { pool, withTransaction } from "../db.js";
import { parseBody, parseQuery } from "../validation/parse.js";
import { PROPOSAL_STATUSES } from "../domain/enums.js";
import { createProposal, listProposals, updateProposal, updateProposalStatus } from "../services/proposals.service.js";

export const proposalsRouter = Router();
proposalsRouter.use(requireAuth);

const listQuerySchema = z.object({
  leadId: z.string().uuid().optional(),
  status: z.enum(PROPOSAL_STATUSES).optional(),
  ownerId: z.string().uuid().optional(),
});

proposalsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const filters = parseQuery(listQuerySchema, req.query);
    res.json({ data: await listProposals(pool, filters) });
  }),
);

const createSchema = z.object({
  leadId: z.string().uuid(),
  title: z.string().min(1),
  fileName: z.string().optional(),
  amount: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

proposalsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parseBody(createSchema, req.body);
    const proposal = await withTransaction((client) => createProposal(client, req.actor!, input));
    res.status(201).json(proposal);
  }),
);

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  fileName: z.string().optional(),
  amount: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

proposalsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const patch = parseBody(updateSchema, req.body);
    const proposal = await withTransaction((client) => updateProposal(client, req.params.id!, patch));
    res.json(proposal);
  }),
);

const statusSchema = z.object({ status: z.enum(PROPOSAL_STATUSES) });

proposalsRouter.post(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const { status } = parseBody(statusSchema, req.body);
    const proposal = await withTransaction((client) => updateProposalStatus(client, req.actor!, req.params.id!, status));
    res.json(proposal);
  }),
);
