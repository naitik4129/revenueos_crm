import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { pool, withTransaction } from "../db.js";
import { env } from "../env.js";
import { parseBody, parseId, parseQuery } from "../validation/parse.js";
import { MEETING_OUTCOMES, MEETING_STATUSES } from "../domain/enums.js";
import { getMeetingOr404, listMeetings, recordMeetingOutcome, scheduleMeeting, updateMeeting } from "../services/meetings.service.js";
import { syncMeetingCancelled, syncMeetingCreated, syncMeetingRescheduled } from "../services/meeting-calendar-sync.service.js";
import { notifyMeetingScheduled } from "../services/meetingScheduledNotification.service.js";

/** Mounted under the workspace-gated crmRouter (routes/index.ts). */
export const meetingsRouter = Router();

const id = (req: { params: Record<string, string | undefined> }) => parseId(req.params.id, "Meeting");

/** Calendar sync and notifications run after the meeting is saved and must never undo or fail it. */
async function bestEffort(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    if (env.NODE_ENV !== "test") console.error(`[meetings] ${label} failed:`, err);
  }
}

meetingsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = parseQuery(
      z.object({ dealId: z.string().uuid().optional(), status: z.enum(MEETING_STATUSES).optional(), ownerId: z.string().uuid().optional() }),
      req.query,
    );
    res.json({ data: await listMeetings(pool, req.workspaceId!, q) });
  }),
);

const createSchema = z.object({
  dealId: z.string().uuid(),
  ownerId: z.string().uuid().optional(),
  title: z.string().min(1),
  at: z.string().datetime({ offset: true }),
  durationMin: z.number().int().positive().optional(),
  url: z.string().url().optional(),
  participants: z.array(z.object({ name: z.string().trim().min(1).optional(), email: z.string().trim().email() })).optional(),
});

meetingsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parseBody(createSchema, req.body);
    const meeting = await withTransaction((db) => scheduleMeeting(db, req.actor!, req.workspaceId!, input));
    await bestEffort("calendar sync", () => syncMeetingCreated(meeting.id));
    await bestEffort("scheduled notification", () => notifyMeetingScheduled(meeting.id));
    res.status(201).json(await getMeetingOr404(pool, req.workspaceId!, meeting.id));
  }),
);

meetingsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await getMeetingOr404(pool, req.workspaceId!, id(req)));
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
    const meeting = await withTransaction((db) => updateMeeting(db, req.actor!, req.workspaceId!, id(req), patch));
    if (patch.status === "cancelled") {
      await bestEffort("calendar cancel", () => syncMeetingCancelled(meeting.id));
    } else if (patch.at !== undefined || patch.title !== undefined || patch.durationMin !== undefined) {
      await bestEffort("calendar reschedule", () => syncMeetingRescheduled(meeting.id));
    }
    res.json(await getMeetingOr404(pool, req.workspaceId!, meeting.id));
  }),
);

meetingsRouter.post(
  "/:id/outcome",
  asyncHandler(async (req, res) => {
    const { outcome, notes } = parseBody(z.object({ outcome: z.enum(MEETING_OUTCOMES), notes: z.string().optional() }), req.body);
    res.json(await withTransaction((db) => recordMeetingOutcome(db, req.actor!, req.workspaceId!, id(req), outcome, notes)));
  }),
);
