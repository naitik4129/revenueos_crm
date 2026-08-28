import type { Queryable } from "../dto.js";
import type { Actor } from "../authMiddleware.js";
import { DoNotContactError, ValidationError } from "../errors.js";
import type { CallConnectedOutcome, CallNotConnectedReason } from "../domain/enums.js";
import { routeConnectedOutcome, routeNotConnected } from "../domain/callRouting.js";
import { addTimelineEvent, actorEvent } from "./timeline.service.js";
import { createTask, cancelOpenTasksForLead } from "./tasks.service.js";
import { getLeadRowOr404, markDnc, setAutomationMode, setContactability, updateLead } from "./leads.service.js";
import { autoEnroll } from "./runs.service.js";
import { addDaysIso } from "../dto.js";

export interface LogCallInput {
  connected: boolean;
  notConnectedReason?: CallNotConnectedReason;
  connectedOutcome?: CallConnectedOutcome;
  notes?: string;
  /** Required when connectedOutcome === 'callback_requested'. */
  callbackDueAt?: string;
}

export interface CallRow {
  id: string;
  lead_id: string;
  salesperson_id: string | null;
  salesperson_name: string;
  connected: boolean;
  not_connected_reason: CallNotConnectedReason | null;
  connected_outcome: CallConnectedOutcome | null;
  notes: string | null;
  callback_due_at: Date | null;
  created_at: Date;
}

function callToDto(row: CallRow) {
  return {
    id: row.id,
    leadId: row.lead_id,
    salespersonId: row.salesperson_id ?? undefined,
    salespersonName: row.salesperson_name,
    connected: row.connected,
    notConnectedReason: row.not_connected_reason ?? undefined,
    connectedOutcome: row.connected_outcome ?? undefined,
    notes: row.notes ?? undefined,
    callbackDueAt: row.callback_due_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Logs a call and processes its full business outcome as one operation
 * (product brief, "CALL PROCESS": "the backend should process the business
 * outcome, not merely save a call record"). Runs inside a single caller-
 * supplied transaction (see routes/calls.routes.ts) so the call record,
 * lead state, task, and workflow enrollment either all land or none do
 * (Rule 16).
 */
export async function logCall(db: Queryable, actor: Actor, leadId: string, input: LogCallInput) {
  const lead = await getLeadRowOr404(db, leadId);
  if (lead.lifecycle_state === "do_not_contact") {
    throw new DoNotContactError("This lead is Do Not Contact — no further contact can be logged.");
  }

  if (input.connected && !input.connectedOutcome) {
    throw new ValidationError("connectedOutcome is required when the call connected.");
  }
  if (!input.connected && !input.notConnectedReason) {
    throw new ValidationError("notConnectedReason is required when the call did not connect.");
  }
  if (input.connectedOutcome === "callback_requested" && !input.callbackDueAt) {
    throw new ValidationError("callbackDueAt is required for a Callback Requested outcome.");
  }
  if (input.callbackDueAt && Date.parse(input.callbackDueAt) <= Date.now()) {
    throw new ValidationError("callbackDueAt must be in the future.");
  }

  const callResult = await db.query<CallRow>(
    `insert into public.calls
      (lead_id, salesperson_id, salesperson_name, connected, not_connected_reason, connected_outcome, notes, callback_due_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     returning *`,
    [
      leadId,
      actor.id,
      actor.fullName,
      input.connected,
      input.connected ? null : input.notConnectedReason,
      input.connected ? input.connectedOutcome : null,
      input.notes?.trim() || null,
      input.connectedOutcome === "callback_requested" ? input.callbackDueAt : null,
    ],
  );
  const call = callResult.rows[0]!;

  await addTimelineEvent(db, {
    leadId,
    kind: "call",
    title: input.connected ? `Call Connected — ${input.connectedOutcome}` : "Call Not Connected",
    detail: input.connected ? input.notes : `${input.notConnectedReason}${input.notes ? ` — ${input.notes}` : ""}`,
    ...actorEvent(actor),
    relatedCallId: call.id,
  });

  // Do Not Contact overrides everything else — shares the same path as the
  // lead-level DNC endpoint (Rule 6).
  if (input.connected && input.connectedOutcome === "do_not_contact") {
    await markDnc(db, actor, leadId, { reason: input.notes?.trim() || "Requested on call" });
    return { call: callToDto(call), lead: await getLeadRowOr404(db, leadId) };
  }

  const routing = input.connected
    ? routeConnectedOutcome(input.connectedOutcome as Exclude<CallConnectedOutcome, "do_not_contact">)
    : routeNotConnected(input.notConnectedReason!);

  if (routing.phoneContactStatus) {
    await setContactability(db, actor, leadId, { channel: "phone", status: routing.phoneContactStatus, reason: `Call outcome: ${input.notConnectedReason}` });
  }

  if (routing.stage) {
    await updateLead(db, actor, leadId, { pipelineStage: routing.stage });
  }
  if (routing.automation) {
    await setAutomationMode(db, actor, leadId, routing.automation, `Call outcome: ${input.connected ? input.connectedOutcome : "Not Connected"}`);
  }

  if (routing.task) {
    const dueAt =
      input.connectedOutcome === "callback_requested" && input.callbackDueAt
        ? input.callbackDueAt
        : addDaysIso(routing.task.dueInDays ?? 1);
    await createTask(db, actor, {
      leadId,
      ownerId: lead.owner_id,
      type: routing.task.type,
      title: routing.task.title,
      dueAt,
      origin: "manual",
    });
  }

  // A fresh reply/outcome makes stale "meeting CTA" nurture obsolete —
  // clear any still-open Send Proposal/Schedule Meeting acquisition tasks
  // that would now conflict with the new next action created above, EXCEPT
  // the one we just created. Positive outcomes move a lead out of nurture
  // entirely, so any leftover nurture follow-up task is now stale.
  if (input.connected && input.connectedOutcome === "positive") {
    await cancelOpenTasksForLead(db, actor, leadId, "Superseded by positive call outcome", ["follow_up", "nurture"]);
  }

  if (routing.workflowTrigger) {
    await autoEnroll(db, leadId, routing.workflowTrigger, `Call outcome: ${input.connected ? input.connectedOutcome : "Not Connected"}`);
  }

  return { call: callToDto(call), lead: await getLeadRowOr404(db, leadId) };
}

export async function listCallsForLead(db: Queryable, leadId: string) {
  const result = await db.query<CallRow>(`select * from public.calls where lead_id = $1 order by created_at desc`, [leadId]);
  return result.rows.map(callToDto);
}
