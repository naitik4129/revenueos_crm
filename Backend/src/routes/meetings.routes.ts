import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../authMiddleware.js";
import { pool, withTransaction } from "../db.js";
import { parseBody, parseQuery } from "../validation/parse.js";
import { MEETING_OUTCOMES, MEETING_STATUSES } from "../domain/enums.js";
import { getMeetingOr404, listMeetings, recordMeetingOutcome, scheduleMeeting, updateMeeting } from "../services/meetings.service.js";
import { syncMeetingCancelled, syncMeetingCreated, syncMeetingRescheduled } from "../services/meeting-calendar-sync.service.js";
import { notifyMeetingScheduled } from "../services/meetingScheduledNotification.service.js";

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
    res.json({ data: await listMeetings(pool, req.workspaceId!, filters) });
  }),
);

const participantSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().email(),
});

const createSchema = z.object({
  leadId: z.string().uuid(),
  ownerId: z.string().uuid().optional(),
  title: z.string().min(1),
  at: z.string().datetime({ offset: true }),
  durationMin: z.number().int().positive().optional(),
  url: z.string().url().optional(),
  participants: z.array(participantSchema).optional(),
});

meetingsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parseBody(createSchema, req.body);
    const meeting = await withTransaction((client) => scheduleMeeting(client, req.actor!, req.workspaceId!, input));
    // Best-effort, outside the transaction — Calendar being disconnected or
    // erroring must not roll back or block the meeting that's already saved.
    await syncMeetingCreated(meeting.id);
    // Also best-effort: sends the email inline and queues WhatsApp for the
    // worker; a notification failure must not undo the booking either.
    await notifyMeetingScheduled(meeting.id);
    res.status(201).json(await getMeetingOr404(pool, req.workspaceId!, meeting.id));
  }),
);

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  at: z.string().datetime({ offset: true }).optional(),
  durationMin: z.number().int().positive().optional(),
  url: z.string().url().optional(),
  status: z.enum(MEETING_STATUSES).optional(),
  notes: z.string().optional(),
});

meetingsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const patch = parseBody(updateSchema, req.body);
    const meeting = await withTransaction((client) => updateMeeting(client, req.actor!, req.workspaceId!, req.params.id!, patch));
    // Same best-effort, non-transactional sync split as the create route.
    if (patch.status === "cancelled") {
      await syncMeetingCancelled(meeting.id);
    } else if (patch.at !== undefined || patch.title !== undefined || patch.durationMin !== undefined) {
      await syncMeetingRescheduled(meeting.id);
    }
    res.json(await getMeetingOr404(pool, req.workspaceId!, meeting.id));
  }),
);

const outcomeSchema = z.object({ outcome: z.enum(MEETING_OUTCOMES), notes: z.string().optional() });

meetingsRouter.post(
  "/:id/outcome",
  asyncHandler(async (req, res) => {
    const { outcome, notes } = parseBody(outcomeSchema, req.body);
    const meeting = await withTransaction((client) => recordMeetingOutcome(client, req.actor!, req.workspaceId!, req.params.id!, outcome, notes));
    res.json(meeting);
  }),
);
