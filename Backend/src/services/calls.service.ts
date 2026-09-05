import type { Queryable } from "../dto.js";
import type { Actor } from "../authMiddleware.js";
import { DoNotContactError, NotFoundError, ValidationError } from "../errors.js";
import type { CallConnectedOutcome, CallNotConnectedReason } from "../domain/enums.js";
import { routeConnectedOutcome, routeNotConnected, type InterestedLaterCapture } from "../domain/callRouting.js";
import { addTimelineEvent, actorEvent } from "./timeline.service.js";
import { createTask, cancelOpenTasksForLead, completeTask } from "./tasks.service.js";
import { getLeadRowOr404, markDnc, setAutomationMode, setContactability, updateLead } from "./leads.service.js";
import { addDaysIso } from "../dto.js";

export interface LogCallInput {
  connected: boolean;
  notConnectedReason?: CallNotConnectedReason;
  connectedOutcome?: CallConnectedOutcome;
  notes?: string;
  /** Required when connectedOutcome === 'callback_requested'. */
  callbackDueAt?: string;
  /** When set, the open 'call' task that prompted this log is completed atomically with it. */
  taskId?: string;
  /** "Interested - Later" capture — read only when connectedOutcome === 'interested_later'. */
  interestedLater?: InterestedLaterCapture;
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

  if (input.taskId) {
    const taskResult = await db.query<{ id: string; lead_id: string; task_type: string; status: string }>(
      `select id, lead_id, task_type, status from public.tasks where id = $1`,
      [input.taskId],
    );
    const task = taskResult.rows[0];
    if (!task) throw new NotFoundError("Task");
    if (task.lead_id !== leadId) throw new ValidationError("Task does not belong to this lead.");
    if (task.task_type !== "call") throw new ValidationError("Only a call task can be completed by logging a call.");
    if (task.status !== "open") throw new ValidationError("This task is no longer open.");
    await completeTask(db, actor, input.taskId);
  }

  // Do Not Contact overrides everything else — shares the same path as the
  // lead-level DNC endpoint (Rule 6).
  if (input.connected && input.connectedOutcome === "do_not_contact") {
    await markDnc(db, actor, leadId, { reason: input.notes?.trim() || "Requested on call" });
    return { call: callToDto(call), lead: await getLeadRowOr404(db, leadId), workflowTrigger: undefined, promptScheduleMeeting: false };
  }

  const routing = input.connected
    ? routeConnectedOutcome(
        input.connectedOutcome as Exclude<CallConnectedOutcome, "do_not_contact">,
        input.interestedLater,
      )
    : routeNotConnected(input.notConnectedReason!);

  if (routing.phoneContactStatus) {
    await setContactability(db, actor, leadId, { channel: "phone", status: routing.phoneContactStatus, reason: `Call outcome: ${input.notConnectedReason}` });
  }

  // stage and objectionType (and, for interested_later, the capture fields)
  // must land in ONE update statement: leads_objection_stage_has_type
  // requires objection_type whenever pipeline_stage = 'objection_nurture',
  // and that constraint is checked against the row as written, not per-column.
  if (routing.stage || routing.objectionType) {
    await updateLead(db, actor, leadId, {
      ...(routing.stage ? { pipelineStage: routing.stage } : {}),
      ...(routing.objectionType ? { objectionType: routing.objectionType } : {}),
      ...(input.connectedOutcome === "interested_later" && input.interestedLater
        ? {
            interestedLaterReason: input.interestedLater.reason,
            interestedLaterRestartAt: input.interestedLater.restartAt,
            interestedLaterNextAction: input.interestedLater.nextAction,
            interestedLaterDecisionOwner: input.interestedLater.decisionOwner,
          }
        : {}),
    });
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

  // Unlike other routing effects, workflow enrollment is NOT applied here —
  // the caller (route handler) surfaces `routing.workflowTrigger` back to the
  // frontend so the rep is always asked which workflow to enroll in, rather
  // than one being silently auto-picked (product decision: nurture entry
  // always prompts a choice).
  return {
    call: callToDto(call),
    lead: await getLeadRowOr404(db, leadId),
    workflowTrigger: routing.workflowTrigger,
    promptScheduleMeeting: routing.promptScheduleMeeting,
  };
}

export async function listCallsForLead(db: Queryable, leadId: string) {
  const result = await db.query<CallRow>(`select * from public.calls where lead_id = $1 order by created_at desc`, [leadId]);
  return result.rows.map(callToDto);
}
