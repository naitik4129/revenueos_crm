import type { Queryable } from "../dto.js";
import type { Actor } from "../authMiddleware.js";
import { ConflictError, DoNotContactError, ValidationError } from "../errors.js";
import type { CallConnectedOutcome, CallNotConnectedReason, EmailStatus } from "../domain/enums.js";
import { routeConnectedOutcome, routeNotConnected, type InterestedLaterCapture } from "../domain/callRouting.js";
import { addDaysIso } from "../dto.js";
import { userNameSql } from "./profiles.service.js";
import { addTimelineEvent, actorEvent } from "./timeline.service.js";
import { cancelOpenTasksForDeal, completeTask, createTask, getTaskOr404 } from "./tasks.service.js";
import { createDeal, dealToDto, getDealOr404, reopenDeal, setAutomationMode, updateDeal } from "./deals.service.js";
import { advanceLifecycle, contactToDto, getContactOr404, markDnc, setContactability } from "./contacts.service.js";

export interface LogCallInput {
  connected: boolean;
  notConnectedReason?: CallNotConnectedReason;
  connectedOutcome?: CallConnectedOutcome;
  notes?: string;
  /** Required when connectedOutcome === 'callback_requested'. */
  callbackDueAt?: string;
  /** When set, the open 'call' task that prompted this log is completed with it. */
  taskId?: string;
  /** "Interested - Later" capture; read only when connectedOutcome === 'interested_later'. */
  interestedLater?: InterestedLaterCapture;
}

/**
 * Outcomes that move the sales pipeline. With no open deal, these reopen the contact's parked
 * (nurture) deal or create one, then route it. Every other outcome is contact-level (DNC, wrong
 * person/fit, callback, any not-connected call incl. wrong/invalid number) and never creates a deal.
 */
const DEAL_OUTCOMES: readonly CallConnectedOutcome[] = [
  "positive",
  "meeting_agreed",
  "interested_later",
  "future_possibility",
  "information_requested",
  "commission_only",
  "internal_hiring",
  "existing_team",
  "budget_price",
  "internal_approval",
];

export function callNeedsDeal(input: Pick<LogCallInput, "connected" | "connectedOutcome">): boolean {
  return input.connected && !!input.connectedOutcome && DEAL_OUTCOMES.includes(input.connectedOutcome);
}

/**
 * Logs a human call and applies its outcome in one transaction: the call is always saved; a
 * pipeline outcome routes the contact's open deal (reopening or creating one if needed);
 * contact-level outcomes stay on the contact. Workflow enrollment is not done here: the
 * outcome's workflowTrigger is returned so the rep picks the workflow.
 */
export async function logCall(db: Queryable, actor: Actor, workspaceId: string, contactId: string, input: LogCallInput) {
  const contact = await getContactOr404(db, workspaceId, contactId);
  if (contact.status === "do_not_contact") throw new DoNotContactError("This contact is Do Not Contact - no further contact can be logged.");
  if (contact.status === "merged") throw new ConflictError("This contact was merged into another contact.");

  if (input.connected && !input.connectedOutcome) throw new ValidationError("connectedOutcome is required when the call connected.");
  if (!input.connected && !input.notConnectedReason) throw new ValidationError("notConnectedReason is required when the call did not connect.");
  if (input.connectedOutcome === "callback_requested" && !input.callbackDueAt) {
    throw new ValidationError("callbackDueAt is required for a Callback Requested outcome.");
  }
  if (input.callbackDueAt && Date.parse(input.callbackDueAt) <= Date.now()) throw new ValidationError("callbackDueAt must be in the future.");

  let task = null;
  if (input.taskId) {
    task = await getTaskOr404(db, workspaceId, input.taskId);
    if (task.contact_id !== contactId) throw new ValidationError("Task does not belong to this contact.");
    if (task.task_type !== "call") throw new ValidationError("Only a call task can be completed by logging a call.");
    if (task.status !== "open") throw new ValidationError("This task is no longer open.");
  }

  // The deal this call routes: the open one, else (pipeline outcomes only) the parked one reopened, else a new one.
  let dealId = contact.open_deal_id;
  if (!dealId && callNeedsDeal(input)) {
    const parked = await db.query<{ id: string }>(
      `select id from crm.deals where contact_id = $1 and outcome = 'nurture' order by updated_at desc limit 1`,
      [contactId],
    );
    dealId = parked.rows[0]
      ? (await reopenDeal(db, actor, workspaceId, parked.rows[0].id, "Reopened by a call outcome")).id
      : (await createDeal(db, actor, workspaceId, { contactId, firstCallTask: false })).id;
  }

  const call = (
    await db.query<{ id: string }>(
      `insert into crm.calls
        (workspace_id, contact_id, deal_id, salesperson_id, connected, not_connected_reason, connected_outcome, notes, callback_due_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [
        workspaceId,
        contactId,
        dealId,
        actor.id,
        input.connected,
        input.connected ? null : input.notConnectedReason,
        input.connected ? input.connectedOutcome : null,
        input.notes?.trim() || null,
        input.connectedOutcome === "callback_requested" ? input.callbackDueAt : null,
      ],
    )
  ).rows[0]!;

  await addTimelineEvent(db, {
    contactId,
    dealId,
    kind: "call",
    title: input.connected ? `Call Connected - ${input.connectedOutcome}` : "Call Not Connected",
    detail: input.connected ? input.notes : `${input.notConnectedReason}${input.notes ? ` - ${input.notes}` : ""}`,
    ...actorEvent(actor),
    relatedCallId: call.id,
  });
  if (task) await completeTask(db, actor, workspaceId, task.id);
  await db.query(`update crm.contacts set last_activity_at = now() where id = $1`, [contactId]);
  await advanceLifecycle(db, contactId, input.connected ? "engaged" : "contacted", actor);

  const result = async (workflowTrigger?: string, promptScheduleMeeting = false) => ({
    call: (await listCallsForContact(db, workspaceId, contactId)).find((c) => c.id === call.id)!,
    contact: contactToDto(await getContactOr404(db, workspaceId, contactId)),
    deal: dealId ? dealToDto(await getDealOr404(db, workspaceId, dealId)) : null,
    workflowTrigger,
    promptScheduleMeeting,
  });

  // Do Not Contact overrides everything else and uses the shared DNC path.
  if (input.connected && input.connectedOutcome === "do_not_contact") {
    await markDnc(db, actor, workspaceId, contactId, { reason: input.notes?.trim() || "Requested on call" });
    return result();
  }

  const routing = input.connected
    ? routeConnectedOutcome(input.connectedOutcome as Exclude<CallConnectedOutcome, "do_not_contact">, input.interestedLater)
    : routeNotConnected(input.notConnectedReason!);

  if (routing.phoneContactStatus) {
    await setContactability(db, actor, workspaceId, contactId, { channel: "phone", status: routing.phoneContactStatus, reason: `Call outcome: ${input.notConnectedReason}` });
  }

  const taskDue = input.connectedOutcome === "callback_requested" && input.callbackDueAt ? input.callbackDueAt : addDaysIso(routing.task?.dueInDays ?? 1);

  if (!dealId) {
    // Contact-level outcome with no deal: only the follow-up task, on the contact.
    if (routing.task) {
      await createTask(db, actor, workspaceId, { contactId, ownerId: contact.owner_id ?? actor.id, type: routing.task.type, title: routing.task.title, dueAt: taskDue });
    }
    return result();
  }

  const deal = await getDealOr404(db, workspaceId, dealId);
  // stage and objection type (and the interested-later capture) land in one update:
  // deals_objection_stage_has_type checks the written row.
  if (routing.stage || routing.objectionType) {
    await updateDeal(db, actor, workspaceId, dealId, {
      ...(routing.stage ? { stage: routing.stage } : {}),
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
  if (routing.automation && routing.automation !== deal.automation_mode) {
    await setAutomationMode(db, actor, workspaceId, dealId, routing.automation, `Call outcome: ${input.connected ? input.connectedOutcome : "Not Connected"}`);
  }
  // A positive outcome makes leftover nurture follow-ups stale.
  if (input.connected && input.connectedOutcome === "positive") {
    await cancelOpenTasksForDeal(db, actor, dealId, "Superseded by positive call outcome", ["follow_up", "nurture"]);
  }
  if (routing.task) {
    await createTask(db, actor, workspaceId, { dealId, ownerId: deal.owner_id, type: routing.task.type, title: routing.task.title, dueAt: taskDue });
  }
  return result(routing.workflowTrigger, routing.promptScheduleMeeting ?? false);
}

interface CallListRow {
  id: string;
  deal_id: string | null;
  source: "human" | "ai";
  salesperson_id: string | null;
  salesperson_name: string | null;
  connected: boolean;
  not_connected_reason: CallNotConnectedReason | null;
  connected_outcome: CallConnectedOutcome | null;
  ai_outcome: string | null;
  direction: string | null;
  notes: string | null;
  callback_due_at: Date | null;
  occurred_at: Date;
  duration_seconds: number | null;
  summary: string | null;
  sentiment: string | null;
  transcript: string | null;
  recording_url: string | null;
}

/** Human and AI calls of a contact, newest first. */
export async function listCallsForContact(db: Queryable, workspaceId: string, contactId: string) {
  await getContactOr404(db, workspaceId, contactId);
  const result = await db.query<CallListRow>(
    `select c.*, ${userNameSql("c.salesperson_id")} as salesperson_name
       from crm.calls c where c.contact_id = $1 order by c.occurred_at desc`,
    [contactId],
  );
  return result.rows.map((r) => ({
    id: r.id,
    dealId: r.deal_id ?? undefined,
    source: r.source,
    salespersonId: r.salesperson_id ?? undefined,
    salespersonName: r.salesperson_name ?? undefined,
    connected: r.connected,
    notConnectedReason: r.not_connected_reason ?? undefined,
    connectedOutcome: r.connected_outcome ?? undefined,
    aiOutcome: r.ai_outcome ?? undefined,
    direction: r.direction ?? undefined,
    notes: r.notes ?? undefined,
    callbackDueAt: r.callback_due_at?.toISOString(),
    at: r.occurred_at.toISOString(),
    durationSeconds: r.duration_seconds ?? undefined,
    summary: r.summary ?? undefined,
    sentiment: r.sentiment ?? undefined,
    transcript: r.transcript ?? undefined,
    recordingUrl: r.recording_url ?? undefined,
  }));
}

/** Campaign emails sent to a contact (from the Email Tool via the brain), newest first. */
export async function listEmailActivities(db: Queryable, workspaceId: string, contactId: string) {
  await getContactOr404(db, workspaceId, contactId);
  const result = await db.query<{
    id: string;
    deal_id: string | null;
    campaign_ref: string | null;
    campaign_name: string | null;
    step: number | null;
    subject: string | null;
    status: EmailStatus;
    reply_text: string | null;
    sent_at: Date | null;
    delivered_at: Date | null;
    opened_at: Date | null;
    replied_at: Date | null;
    bounced_at: Date | null;
    unsubscribed_at: Date | null;
    created_at: Date;
  }>(`select * from crm.email_activities where contact_id = $1 order by coalesce(sent_at, created_at) desc`, [contactId]);
  return result.rows.map((r) => ({
    id: r.id,
    dealId: r.deal_id ?? undefined,
    campaignRef: r.campaign_ref ?? undefined,
    campaignName: r.campaign_name ?? undefined,
    step: r.step ?? undefined,
    subject: r.subject ?? undefined,
    status: r.status,
    replyText: r.reply_text ?? undefined,
    sentAt: r.sent_at?.toISOString(),
    deliveredAt: r.delivered_at?.toISOString(),
    openedAt: r.opened_at?.toISOString(),
    repliedAt: r.replied_at?.toISOString(),
    bouncedAt: r.bounced_at?.toISOString(),
    unsubscribedAt: r.unsubscribed_at?.toISOString(),
  }));
}
