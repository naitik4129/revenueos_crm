import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { pool, withTransaction } from "../db.js";
import { parseBody, parseId, parseQuery } from "../validation/parse.js";
import { CALL_CONNECTED_OUTCOMES, CALL_NOT_CONNECTED_REASONS, CONTACT_CHANNELS, CONTACT_STATUSES, LIFECYCLE_STAGES } from "../domain/enums.js";
import * as contacts from "../services/contacts.service.js";
import { sortValues } from "../dto.js";
import { contactToDto } from "../services/contacts.service.js";
import { listDeals } from "../services/deals.service.js";
import { listTimeline } from "../services/timeline.service.js";
import { listCallsForContact, listEmailActivities, logCall } from "../services/calls.service.js";
import { listTasks } from "../services/tasks.service.js";

/** Mounted under the workspace-gated crmRouter (routes/index.ts). */
export const contactsRouter = Router();

const id = (req: { params: Record<string, string | undefined> }) => parseId(req.params.id, "Contact");
const page = { limit: z.coerce.number().int().positive().max(500).optional(), offset: z.coerce.number().int().min(0).optional() };

// Field rules (required first name, email/phone/LinkedIn, known source) live in
// contacts.validateContactFields so single create and CSV import report the same errors.
const contactFields = {
  lastName: z.string().optional(),
  jobTitle: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  linkedinUrl: z.string().optional(),
  country: z.string().optional(),
  location: z.string().optional(),
  source: z.string().optional(),
  companyId: z.string().uuid().nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
};

contactsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = parseQuery(
      z.object({
        search: z.string().optional(),
        lifecycleStage: z.enum(LIFECYCLE_STAGES).optional(),
        status: z.enum(CONTACT_STATUSES).optional(),
        // "none" = no owner (the Unassigned view).
        ownerId: z.union([z.string().uuid(), z.literal("none")]).optional(),
        companyId: z.string().uuid().optional(),
        sort: z.enum(sortValues(contacts.CONTACT_SORTS)).optional(),
        ...page,
      }),
      req.query,
    );
    res.json(await contacts.listContacts(pool, req.workspaceId!, q));
  }),
);

contactsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parseBody(z.object({ firstName: z.string().optional(), createDeal: z.boolean().optional(), ...contactFields }), req.body);
    const row = await withTransaction((db) => contacts.createContact(db, req.actor!, req.workspaceId!, { ...input, firstName: input.firstName ?? "" }));
    res.status(201).json(contactToDto(row));
  }),
);

const importSchema = z.object({
  rows: z
    .array(
      z.object({
        rowNumber: z.number().int().positive(),
        firstName: z.string(),
        lastName: z.string().optional(),
        jobTitle: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        linkedinUrl: z.string().optional(),
        country: z.string().optional(),
        location: z.string().optional(),
        // A bare string so an unknown source fails only its row, not the whole file.
        source: z.string().optional(),
        company: z.string().optional(),
        website: z.string().optional(),
        industry: z.string().optional(),
        createDeal: z.union([z.boolean(), z.string()]).optional(),
        dealTitle: z.string().optional(),
      }),
    )
    .min(1, "The file has no data rows to import.")
    .max(2000, "This file has more than 2000 rows - split it and import in batches."),
});

contactsRouter.post(
  "/import",
  asyncHandler(async (req, res) => {
    const { rows } = parseBody(importSchema, req.body);
    const data = await withTransaction((db) => contacts.importContacts(db, req.actor!, req.workspaceId!, rows));
    res.status(201).json({ data });
  }),
);

contactsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(contactToDto(await contacts.getContactOr404(pool, req.workspaceId!, id(req))));
  }),
);

contactsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const patch = parseBody(z.object({ firstName: z.string().optional(), ...contactFields }), req.body);
    const row = await withTransaction((db) => contacts.updateContact(db, req.actor!, req.workspaceId!, id(req), patch));
    res.json(contactToDto(row));
  }),
);

contactsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await withTransaction((db) => contacts.deleteContact(db, req.actor!, req.workspaceId!, id(req)));
    res.status(204).send();
  }),
);

// --- Notes ---------------------------------------------------------------------

contactsRouter.get(
  "/:id/notes",
  asyncHandler(async (req, res) => {
    res.json({ data: await contacts.listNotes(pool, req.workspaceId!, id(req)) });
  }),
);

contactsRouter.post(
  "/:id/notes",
  asyncHandler(async (req, res) => {
    const input = parseBody(z.object({ body: z.string().min(1), dealId: z.string().uuid().optional() }), req.body);
    res.status(201).json(await withTransaction((db) => contacts.addNote(db, req.actor!, req.workspaceId!, id(req), input)));
  }),
);

// --- Consent, lifecycle, merge ------------------------------------------------------

const reasonSchema = z.object({ reason: z.string().min(1) });

contactsRouter.post(
  "/:id/dnc",
  asyncHandler(async (req, res) => {
    const input = parseBody(reasonSchema, req.body);
    res.json(contactToDto(await withTransaction((db) => contacts.markDnc(db, req.actor!, req.workspaceId!, id(req), input))));
  }),
);

contactsRouter.post(
  "/:id/dnc/reactivate",
  asyncHandler(async (req, res) => {
    const { reason } = parseBody(reasonSchema, req.body);
    res.json(contactToDto(await withTransaction((db) => contacts.reactivateFromDnc(db, req.actor!, req.workspaceId!, id(req), reason))));
  }),
);

contactsRouter.post(
  "/:id/lifecycle",
  asyncHandler(async (req, res) => {
    const input = parseBody(z.object({ stage: z.enum(LIFECYCLE_STAGES), note: z.string().optional() }), req.body);
    res.json(contactToDto(await withTransaction((db) => contacts.setLifecycleStage(db, req.actor!, req.workspaceId!, id(req), input))));
  }),
);

/** Merges this contact (the duplicate) into `targetContactId`; returns the target. */
contactsRouter.post(
  "/:id/merge",
  asyncHandler(async (req, res) => {
    const { targetContactId, reason } = parseBody(z.object({ targetContactId: z.string().uuid(), reason: z.string().optional() }), req.body);
    const row = await withTransaction((db) => contacts.mergeContacts(db, req.actor!, req.workspaceId!, id(req), targetContactId, reason));
    res.json(contactToDto(row));
  }),
);

// --- Contactability / communications ------------------------------------------------

contactsRouter.get(
  "/:id/contactability",
  asyncHandler(async (req, res) => {
    res.json({ data: await contacts.listContactability(pool, req.workspaceId!, id(req)) });
  }),
);

contactsRouter.post(
  "/:id/contactability",
  asyncHandler(async (req, res) => {
    const input = parseBody(z.object({ channel: z.enum(CONTACT_CHANNELS), status: z.string().min(1), reason: z.string().optional() }), req.body);
    res.json({ data: await withTransaction((db) => contacts.setContactability(db, req.actor!, req.workspaceId!, id(req), input)) });
  }),
);

contactsRouter.post(
  "/:id/communications",
  asyncHandler(async (req, res) => {
    const input = parseBody(
      z.object({ channel: z.enum(["email", "whatsapp"]), detail: z.string().optional(), dealId: z.string().uuid().optional() }),
      req.body,
    );
    res.status(201).json(await withTransaction((db) => contacts.logManualCommunication(db, req.actor!, req.workspaceId!, id(req), input)));
  }),
);

// --- Related lists ----------------------------------------------------------------------

contactsRouter.get(
  "/:id/deals",
  asyncHandler(async (req, res) => {
    const contactId = (await contacts.getContactOr404(pool, req.workspaceId!, id(req))).id;
    res.json(await listDeals(pool, req.workspaceId!, { ...parseQuery(z.object(page), req.query), contactId }));
  }),
);

contactsRouter.get(
  "/:id/timeline",
  asyncHandler(async (req, res) => {
    const contactId = (await contacts.getContactOr404(pool, req.workspaceId!, id(req))).id;
    res.json({ data: await listTimeline(pool, req.workspaceId!, { ...parseQuery(z.object(page), req.query), contactId }) });
  }),
);

// --- Calls (human + AI), email activity, tasks ---------------------------------------------

const logCallSchema = z.object({
  connected: z.boolean(),
  notConnectedReason: z.enum(CALL_NOT_CONNECTED_REASONS).optional(),
  connectedOutcome: z.enum(CALL_CONNECTED_OUTCOMES).optional(),
  notes: z.string().optional(),
  callbackDueAt: z.string().datetime({ offset: true }).optional(),
  taskId: z.string().uuid().optional(),
  // "Interested - Later" capture, read only when connectedOutcome = interested_later.
  interestedLater: z
    .object({ reason: z.string().optional(), restartAt: z.string().optional(), nextAction: z.string().optional(), decisionOwner: z.string().optional() })
    .optional(),
});

contactsRouter.post(
  "/:id/calls",
  asyncHandler(async (req, res) => {
    const input = parseBody(logCallSchema, req.body);
    res.status(201).json(await withTransaction((db) => logCall(db, req.actor!, req.workspaceId!, id(req), input)));
  }),
);

contactsRouter.get(
  "/:id/calls",
  asyncHandler(async (req, res) => {
    res.json({ data: await listCallsForContact(pool, req.workspaceId!, id(req)) });
  }),
);

contactsRouter.get(
  "/:id/email-activities",
  asyncHandler(async (req, res) => {
    res.json({ data: await listEmailActivities(pool, req.workspaceId!, id(req)) });
  }),
);

contactsRouter.get(
  "/:id/tasks",
  asyncHandler(async (req, res) => {
    const contactId = (await contacts.getContactOr404(pool, req.workspaceId!, id(req))).id;
    res.json(await listTasks(pool, req.workspaceId!, { ...parseQuery(z.object(page), req.query), contactId }));
  }),
);
