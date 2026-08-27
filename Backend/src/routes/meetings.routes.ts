import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../authMiddleware.js";
import { pool, withTransaction } from "../db.js";
import { parseBody, parseQuery } from "../validation/parse.js";
import { MEETING_OUTCOMES, MEETING_STATUSES } from "../domain/enums.js";
import { listMeetings, recordMeetingOutcome, scheduleMeeting, updateMeeting } from "../services/meetings.service.js";

export const meetingsRouter = Router();
meetingsRouter.use(requireAuth);

const listQuerySchema = z.object({
  leadId: z.string().uuid().optional(),
  status: z.enum(MEETING_STATUSES).optional(),
  ownerId: z.string().uuid().optional(),
});

meetingsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const filters = parseQuery(listQuerySchema, req.query);
    res.json({ data: await listMeetings(pool, filters) });
  }),
);

const createSchema = z.object({
  leadId: z.string().uuid(),
  ownerId: z.string().uuid().optional(),
  title: z.string().min(1),
  at: z.string().datetime({ offset: true }),
  durationMin: z.number().int().positive().optional(),
  url: z.string().optional(),
});

meetingsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parseBody(createSchema, req.body);
    const meeting = await withTransaction((client) => scheduleMeeting(client, req.actor!, input));
    res.status(201).json(meeting);
  }),
);

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  at: z.string().datetime({ offset: true }).optional(),
  durationMin: z.number().int().positive().optional(),
  url: z.string().optional(),
  status: z.enum(MEETING_STATUSES).optional(),
  notes: z.string().optional(),
});

meetingsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const patch = parseBody(updateSchema, req.body);
    const meeting = await withTransaction((client) => updateMeeting(client, req.actor!, req.params.id!, patch));
    res.json(meeting);
  }),
);

const outcomeSchema = z.object({ outcome: z.enum(MEETING_OUTCOMES), notes: z.string().optional() });

meetingsRouter.post(
  "/:id/outcome",
  asyncHandler(async (req, res) => {
    const { outcome, notes } = parseBody(outcomeSchema, req.body);
    const meeting = await withTransaction((client) => recordMeetingOutcome(client, req.actor!, req.params.id!, outcome, notes));
    res.json(meeting);
  }),
);
