import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../authMiddleware.js";
import { pool, withTransaction } from "../db.js";
import { parseBody, parseQuery } from "../validation/parse.js";
import {
  LEAD_SOURCES,
  PIPELINE_STAGES,
  AUTOMATION_MODES,
  LIFECYCLE_STATES,
  RESPONSE_STATES,
  CONTACT_CHANNELS,
  CALL_NOT_CONNECTED_REASONS,
  CALL_CONNECTED_OUTCOMES,
  LEAD_LOSS_REASONS,
} from "../domain/enums.js";
import * as leadsService from "../services/leads.service.js";
import { leadToDto } from "../services/leads.service.js";
import { getLeadNextAction } from "../services/tasks.service.js";
import { listTimelineForLead } from "../services/timeline.service.js";
import { logCall, listCallsForLead } from "../services/calls.service.js";
import { listMeetings } from "../services/meetings.service.js";
import { listProposals } from "../services/proposals.service.js";
import { listRuns } from "../services/runs.service.js";

export const leadsRouter = Router();
leadsRouter.use(requireAuth);

// firstName/company/source are bare optional strings, not z.string().min(1)/
// z.enum(LEAD_SOURCES) -- a blank/unknown value is left for
// leadsService.validateLeadFields to reject with its friendly, field-tagged
// message, the same single source of truth the CSV import path already uses,
// rather than failing here with Zod's differently-shaped .flatten() error.
// email format is validated there too (normalizeEmail), not here, so it's
// checked once, not by two different validators.
const createLeadSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  company: z.string().optional(),
  jobTitle: z.string().optional(),
  industry: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  source: z.string().optional(),
  serviceInterest: z.string().optional(),
  ownerId: z.string().uuid().optional(),
});

leadsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parseBody(createLeadSchema, req.body);
    const lead = await withTransaction((client) =>
      leadsService.createLead(client, req.actor!, {
        ...input,
        firstName: input.firstName ?? "",
        company: input.company ?? "",
        source: input.source ?? "",
      }),
    );
    res.status(201).json(await withNextAction(lead));
  }),
);

// --- Bulk CSV import ---------------------------------------------------------

const importRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  firstName: z.string(),
  lastName: z.string().optional(),
  company: z.string(),
  jobTitle: z.string().optional(),
  industry: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  // Left as a bare string (not z.enum(LEAD_SOURCES)) so an unrecognized
  // value fails only that row, with leadsService.validateLeadFields's
  // friendly message, instead of rejecting the whole batch at the schema
  // layer -- partial import is the product decision here, not
  // all-or-nothing.
  source: z.string(),
  serviceInterest: z.string().optional(),
});

const importLeadsSchema = z.object({
  rows: z
    .array(importRowSchema)
    .min(1, "The file has no data rows to import.")
    .max(2000, "This file has more than 2000 rows - split it and import in batches."),
});

leadsRouter.post(
  "/import",
  asyncHandler(async (req, res) => {
    const input = parseBody(importLeadsSchema, req.body);
    const result = await withTransaction((client) => leadsService.importLeads(client, req.actor!, input.rows));
    res.status(201).json({
      data: {
        created: result.created.map((row) => leadToDto(row)),
        duplicates: result.duplicates,
        failed: result.failed,
        totalRows: result.totalRows,
      },
    });
  }),
);

const listLeadsQuerySchema = z.object({
  stage: z.enum(PIPELINE_STAGES).optional(),
  lifecycle: z.enum(LIFECYCLE_STATES).optional(),
  ownerId: z.string().uuid().optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  automationMode: z.enum(AUTOMATION_MODES).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

leadsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const filters = parseQuery(listLeadsQuerySchema, req.query);
    const leads = await leadsService.listLeads(pool, filters);
    res.json({ data: leads });
  }),
);

leadsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const row = await leadsService.getLeadRowOr404(pool, req.params.id!);
    res.json(await withNextAction(row));
  }),
);

async function withNextAction(row: leadsService.LeadRow) {
  const nextAction = await getLeadNextAction(pool, row.id);
  return leadToDto(row, nextAction);
}

// firstName/company/source left as bare optional strings, not
// z.string().min(1)/z.enum(LEAD_SOURCES) -- leadsService.updateLead
// re-validates all three itself (non-blank, known source) with the same
// field-tagged ValidationError shape createLead uses, instead of Zod's
// differently-shaped .flatten() error. email format is validated there too.
const updateLeadSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  company: z.string().optional(),
  jobTitle: z.string().optional(),
  industry: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  source: z.string().optional(),
  serviceInterest: z.string().optional(),
  ownerId: z.string().uuid().optional(),
  pipelineStage: z.enum(PIPELINE_STAGES).optional(),
  responseState: z.enum(RESPONSE_STATES).optional(),
});

leadsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const patch = parseBody(updateLeadSchema, req.body);
    const lead = await withTransaction((client) => leadsService.updateLead(client, req.actor!, req.params.id!, patch));
    res.json(await withNextAction(lead));
  }),
);

/**
 * Permanent delete. Gated the same as every other lead-mutating route here
 * (requireAuth + requireSalesperson, applied at the crmRouter level in
 * routes/index.ts) -- admin accounts are walled off from all CRM data in
 * this app (see requireSalesperson), so there is no more-privileged tier
 * within leads to additionally require. Irreversible and cascades across
 * every related table -- see leadsService.deleteLead and
 * 007_lead_hard_delete.sql.
 */
leadsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await withTransaction((client) => leadsService.deleteLead(client, req.actor!, req.params.id!));
    res.status(204).send();
  }),
);

// --- Notes -----------------------------------------------------------------

leadsRouter.get(
  "/:id/notes",
  asyncHandler(async (req, res) => {
    res.json({ data: await leadsService.listNotes(pool, req.params.id!) });
  }),
);

const addNoteSchema = z.object({ body: z.string().min(1) });

leadsRouter.post(
  "/:id/notes",
  asyncHandler(async (req, res) => {
    const { body } = parseBody(addNoteSchema, req.body);
    const note = await withTransaction((client) => leadsService.addNote(client, req.actor!, req.params.id!, body));
    res.status(201).json(note);
  }),
);

// --- Automation / DNC / lifecycle -------------------------------------------

const automationSchema = z.object({ mode: z.enum(AUTOMATION_MODES), reason: z.string().optional() });

leadsRouter.post(
  "/:id/automation",
  asyncHandler(async (req, res) => {
    const { mode, reason } = parseBody(automationSchema, req.body);
    const lead = await withTransaction((client) => leadsService.setAutomationMode(client, req.actor!, req.params.id!, mode, reason));
    res.json(await withNextAction(lead));
  }),
);

const dncSchema = z.object({ reason: z.string().min(1) });

leadsRouter.post(
  "/:id/dnc",
  asyncHandler(async (req, res) => {
    const input = parseBody(dncSchema, req.body);
    const lead = await withTransaction((client) => leadsService.markDnc(client, req.actor!, req.params.id!, input));
    res.json(await withNextAction(lead));
  }),
);

const reasonSchema = z.object({ reason: z.string().min(1) });

leadsRouter.post(
  "/:id/dnc/reactivate",
  asyncHandler(async (req, res) => {
    const { reason } = parseBody(reasonSchema, req.body);
    const lead = await withTransaction((client) => leadsService.reactivateFromDnc(client, req.actor!, req.params.id!, reason));
    res.json(await withNextAction(lead));
  }),
);

const optionalReasonSchema = z.object({ reason: z.string().optional() });

leadsRouter.post(
  "/:id/won",
  asyncHandler(async (req, res) => {
    const { reason } = parseBody(optionalReasonSchema, req.body);
    const lead = await withTransaction((client) => leadsService.markWon(client, req.actor!, req.params.id!, reason));
    res.json(await withNextAction(lead));
  }),
);

const markLostSchema = z.object({ lossReason: z.enum(LEAD_LOSS_REASONS), notes: z.string().optional() });

leadsRouter.post(
  "/:id/lost",
  asyncHandler(async (req, res) => {
    const { lossReason, notes } = parseBody(markLostSchema, req.body);
    const lead = await withTransaction((client) => leadsService.markLost(client, req.actor!, req.params.id!, lossReason, notes));
    res.json(await withNextAction(lead));
  }),
);

leadsRouter.post(
  "/:id/discard",
  asyncHandler(async (req, res) => {
    const { reason } = parseBody(optionalReasonSchema, req.body);
    const lead = await withTransaction((client) => leadsService.markDiscarded(client, req.actor!, req.params.id!, reason));
    res.json(await withNextAction(lead));
  }),
);

// A rep-initiated "this lead is going quiet, park it" action.
// moveToLongTermNurture already existed (reached only from meeting/proposal
// routing); this is its first direct HTTP entry point.
leadsRouter.post(
  "/:id/long-term-nurture",
  asyncHandler(async (req, res) => {
    const { reason } = parseBody(optionalReasonSchema, req.body);
    const lead = await withTransaction((client) => leadsService.moveToLongTermNurture(client, req.actor!, req.params.id!, reason));
    res.json(await withNextAction(lead));
  }),
);

leadsRouter.post(
  "/:id/reactivate",
  asyncHandler(async (req, res) => {
    const { reason } = parseBody(optionalReasonSchema, req.body);
    const lead = await withTransaction((client) => leadsService.reactivateLead(client, req.actor!, req.params.id!, reason));
    res.json(await withNextAction(lead));
  }),
);

const mergeSchema = z.object({ targetLeadId: z.string().uuid(), reason: z.string().optional() });

leadsRouter.post(
  "/:id/merge",
  asyncHandler(async (req, res) => {
    const { targetLeadId, reason } = parseBody(mergeSchema, req.body);
    const lead = await withTransaction((client) => leadsService.mergeLead(client, req.actor!, req.params.id!, targetLeadId, reason));
    res.json(await withNextAction(lead));
  }),
);

// --- Contactability ----------------------------------------------------------

const contactabilitySchema = z.object({ channel: z.enum(CONTACT_CHANNELS), status: z.string().min(1), reason: z.string().optional() });

leadsRouter.get(
  "/:id/contactability",
  asyncHandler(async (req, res) => {
    res.json({ data: await leadsService.listContactability(pool, req.params.id!) });
  }),
);

leadsRouter.post(
  "/:id/contactability",
  asyncHandler(async (req, res) => {
    const input = parseBody(contactabilitySchema, req.body);
    const data = await withTransaction((client) => leadsService.setContactability(client, req.actor!, req.params.id!, input));
    res.json({ data });
  }),
);

// --- Calls -------------------------------------------------------------------

const interestedLaterCaptureSchema = z.object({
  reason: z.string().optional(),
  restartAt: z.string().optional(),
  nextAction: z.string().optional(),
  decisionOwner: z.string().optional(),
});

const logCallSchema = z.object({
  connected: z.boolean(),
  notConnectedReason: z.enum(CALL_NOT_CONNECTED_REASONS).optional(),
  connectedOutcome: z.enum(CALL_CONNECTED_OUTCOMES).optional(),
  notes: z.string().optional(),
  callbackDueAt: z.string().datetime({ offset: true }).optional(),
  taskId: z.string().uuid().optional(),
  // "Interested - Later" capture — only meaningful (and only read by
  // logCall) when connectedOutcome === 'interested_later'.
  interestedLater: interestedLaterCaptureSchema.optional(),
});

leadsRouter.get(
  "/:id/calls",
  asyncHandler(async (req, res) => {
    res.json({ data: await listCallsForLead(pool, req.params.id!) });
  }),
);

leadsRouter.post(
  "/:id/calls",
  asyncHandler(async (req, res) => {
    const input = parseBody(logCallSchema, req.body);
    const result = await withTransaction((client) => logCall(client, req.actor!, req.params.id!, input));
    res.status(201).json({
      call: result.call,
      lead: await withNextAction(result.lead),
      workflowTrigger: result.workflowTrigger,
      promptScheduleMeeting: result.promptScheduleMeeting,
    });
  }),
);

const communicationSchema = z.object({
  channel: z.enum(["email", "whatsapp"]),
  detail: z.string().optional(),
});

leadsRouter.post(
  "/:id/communications",
  asyncHandler(async (req, res) => {
    const input = parseBody(communicationSchema, req.body);
    res.status(201).json(await withTransaction((client) => leadsService.logManualCommunication(client, req.actor!, req.params.id!, input)));
  }),
);

// --- Timeline / detail sub-resources ------------------------------------------

leadsRouter.get(
  "/:id/timeline",
  asyncHandler(async (req, res) => {
    res.json({ data: await listTimelineForLead(pool, req.params.id!) });
  }),
);

leadsRouter.get(
  "/:id/meetings",
  asyncHandler(async (req, res) => {
    res.json({ data: await listMeetings(pool, { leadId: req.params.id! }) });
  }),
);

leadsRouter.get(
  "/:id/proposals",
  asyncHandler(async (req, res) => {
    res.json({ data: await listProposals(pool, { leadId: req.params.id! }) });
  }),
);

leadsRouter.get(
  "/:id/runs",
  asyncHandler(async (req, res) => {
    res.json({ data: await listRuns(pool, { leadId: req.params.id! }) });
  }),
);
