import type { Queryable } from "../dto.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors.js";
import { notifyOwnerOrMembers } from "./notifications.service.js";
import type { TaskType, WorkflowRunStatus, WorkflowStepAction } from "../domain/enums.js";
import { assertValidPipelineStage, canRunAutomation } from "../domain/pipeline.js";
import type { TemplateRenderContext, TemplateRenderMeeting } from "../domain/templateRenderer.js";
import { addTimelineEvent, AUTOMATION_ACTOR } from "./timeline.service.js";
import { getRunRowOr404, scheduleStepAfter, type RunRow } from "./runs.service.js";
import { dealRenderContext, getDealOr404, updateDeal, type DealRow } from "./deals.service.js";
import { createTask } from "./tasks.service.js";
import { getLatestMeetingForDeal, toRenderMeeting } from "./meetings.service.js";
import { BLOCKED_EMAIL_STATUSES as BLOCKED_EMAIL, BLOCKED_WHATSAPP_STATUSES as BLOCKED_WHATSAPP } from "./consent.service.js";

/**
 * The only place automation business rules run. The worker (automation-runner.ts) claims due
 * actions and calls these functions; it never decides what a step means or what happens next.
 */

const MESSAGE_ACTION_TYPES: WorkflowStepAction[] = ["send_email", "send_whatsapp"];
const INTERNAL_ACTION_TYPES: WorkflowStepAction[] = ["create_call_task", "create_follow_up_task", "change_lead_stage", "stop_workflow"];


/** How long a send waits when the deal's automation is paused. */
const PAUSED_RETRY_MS = 60 * 60_000;

interface ScheduledActionRow {
  id: string;
  workspace_id: string;
  deal_id: string;
  workflow_run_id: string;
  workflow_step_id: string;
  action_type: WorkflowStepAction;
  scheduled_for: Date;
  status: string;
  payload: Record<string, unknown>;
  attempt_count: number;
  max_attempts: number;
  last_attempt_at: Date | null;
  last_error: string | null;
  executed_at: Date | null;
}

async function getActionRowOr404(db: Queryable, id: string): Promise<ScheduledActionRow> {
  const result = await db.query<ScheduledActionRow>(`select * from crm_scheduled_actions where id = $1`, [id]);
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Scheduled action");
  return row;
}

interface StepRow {
  id: string;
  step_order: number;
  delay_days: number;
  action: WorkflowStepAction;
  config: string | null;
  template_id: string | null;
}

interface TemplateRow {
  id: string;
  name: string;
  channel: "email" | "whatsapp";
  subject: string | null;
  body: string;
  is_active: boolean;
}

/**
 * ok, or what to do instead of acting:
 *  - stop:  the contact is not active, the deal is closed, or automation is manual/stopped -> skip and stop the run
 *  - defer: the deal's automation is paused -> back to the queue, no retry used
 *  - pause: the run itself is paused -> the action waits paused
 *  - skip:  this one message can't go (no address, blocked channel, no/inactive template) -> skip, run moves on
 */
export type Eligibility = { ok: true } | { ok: false; kind: "stop" | "defer" | "pause" | "skip"; reason: string };

// Template skips are a configuration problem nobody would otherwise see, so they notify (see applyIneligible).
const NO_TEMPLATE = "No template resolved for this step.";
const INACTIVE_TEMPLATE = "Template is inactive.";

function computeEligibility(
  action: ScheduledActionRow,
  deal: DealRow,
  run: RunRow,
  template: TemplateRow | null,
  channels: Map<string, string>,
): Eligibility {
  if (run.status === "paused") return { ok: false, kind: "pause", reason: "Workflow run is paused." };
  if (!["running", "waiting"].includes(run.status)) return { ok: false, kind: "skip", reason: `Workflow run status is "${run.status}".` };
  if (!canRunAutomation(deal.outcome, deal.contact_status)) {
    return { ok: false, kind: "stop", reason: `Deal is "${deal.outcome}" and contact is "${deal.contact_status}".` };
  }
  if (deal.automation_mode === "paused") return { ok: false, kind: "defer", reason: "Deal automation is paused." };
  if (deal.automation_mode !== "active") return { ok: false, kind: "stop", reason: `Deal automation is "${deal.automation_mode}".` };

  if (action.action_type === "send_email") {
    if (!deal.email) return { ok: false, kind: "skip", reason: "Contact has no email address." };
    const status = channels.get("email");
    if (status && BLOCKED_EMAIL.includes(status)) return { ok: false, kind: "skip", reason: `Email channel is "${status}".` };
  }
  if (action.action_type === "send_whatsapp") {
    if (!deal.phone_e164) return { ok: false, kind: "skip", reason: "Contact has no valid phone number." };
    const status = channels.get("whatsapp");
    if (status && BLOCKED_WHATSAPP.includes(status)) return { ok: false, kind: "skip", reason: `WhatsApp channel is "${status}".` };
    if (channels.get("phone") === "do_not_contact") return { ok: false, kind: "skip", reason: `Phone channel is "do_not_contact".` };
  }
  if (MESSAGE_ACTION_TYPES.includes(action.action_type)) {
    if (!template) return { ok: false, kind: "skip", reason: NO_TEMPLATE };
    if (!template.is_active) return { ok: false, kind: "skip", reason: INACTIVE_TEMPLATE };
  }
  return { ok: true };
}

export interface ActionContext {
  workspaceId: string;
  action: {
    id: string;
    actionType: WorkflowStepAction;
    status: string;
    scheduledFor: string;
    payload: Record<string, unknown>;
    attemptCount: number;
    maxAttempts: number;
  };
  deal: { id: string; contactId: string; email: string | null; phoneE164: string | null; ownerId: string | null };
  render: TemplateRenderContext;
  run: { id: string; workflowId: string; status: WorkflowRunStatus; currentStepId: string | null };
  step: { id: string; order: number; delayDays: number; action: WorkflowStepAction; config: string | null } | null;
  template:
    | {
        id: string;
        name: string;
        channel: "email" | "whatsapp";
        subject: string | null;
        body: string;
        attachments: { id: string; storagePath: string; fileName: string; mimeType: string }[];
      }
    | null;
  meeting: TemplateRenderMeeting | null;
  eligibility: Eligibility;
}

async function buildContext(db: Queryable, action: ScheduledActionRow): Promise<ActionContext> {
  const run = await getRunRowOr404(db, action.workspace_id, action.workflow_run_id);
  const deal = await getDealOr404(db, action.workspace_id, action.deal_id);
  const step =
    (await db.query<StepRow>(`select id, step_order, delay_days, action, config, template_id from crm_workflow_steps where id = $1`, [action.workflow_step_id]))
      .rows[0] ?? null;

  const templateId = (action.payload as { templateId?: string | null }).templateId ?? step?.template_id ?? null;
  let template: TemplateRow | null = null;
  let attachments: NonNullable<ActionContext["template"]>["attachments"] = [];
  if (templateId) {
    template =
      (
        await db.query<TemplateRow>(`select id, name, channel, subject, body, is_active from crm_message_templates where id = $1 and workspace_id = $2`, [
          templateId,
          action.workspace_id,
        ])
      ).rows[0] ?? null;
    if (template) {
      const rows = await db.query<{ id: string; storage_path: string; file_name: string; mime_type: string }>(
        `select id, storage_path, file_name, mime_type from crm_template_attachments where template_id = $1 order by created_at asc`,
        [templateId],
      );
      attachments = rows.rows.map((r) => ({ id: r.id, storagePath: r.storage_path, fileName: r.file_name, mimeType: r.mime_type }));
    }
  }

  const channels = new Map(
    (await db.query<{ channel: string; status: string }>(`select channel, status from crm_contact_channels where contact_id = $1`, [deal.contact_id])).rows.map(
      (r) => [r.channel, r.status] as const,
    ),
  );
  let meeting: TemplateRenderMeeting | null = null;
  if (MESSAGE_ACTION_TYPES.includes(action.action_type)) {
    const meetingRow = await getLatestMeetingForDeal(db, deal.id);
    meeting = meetingRow ? toRenderMeeting(meetingRow) : null;
  }

  return {
    workspaceId: action.workspace_id,
    action: {
      id: action.id,
      actionType: action.action_type,
      status: action.status,
      scheduledFor: action.scheduled_for.toISOString(),
      payload: action.payload,
      attemptCount: action.attempt_count,
      maxAttempts: action.max_attempts,
    },
    deal: { id: deal.id, contactId: deal.contact_id, email: deal.email, phoneE164: deal.phone_e164, ownerId: deal.owner_id },
    render: dealRenderContext(deal),
    run: { id: run.id, workflowId: run.workflow_id, status: run.status, currentStepId: run.current_step_id },
    step: step ? { id: step.id, order: step.step_order, delayDays: step.delay_days, action: step.action, config: step.config } : null,
    template: template ? { id: template.id, name: template.name, channel: template.channel, subject: template.subject, body: template.body, attachments } : null,
    meeting,
    eligibility: computeEligibility(action, deal, run, template, channels),
  };
}

/**
 * Concurrency-safe claim: one UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED), so two
 * workers never claim the same row. Rows stuck in 'executing' for >15 minutes (a crashed worker)
 * are reclaimed. Returns ids only: each action's eligibility is computed right before it runs.
 */
export async function claimDueActionIds(db: Queryable, limit: number): Promise<string[]> {
  // Two claims, one per partial index (an `or` across them scans the whole table), then the earliest $1 of both.
  const claimed = await db.query<{ id: string }>(
    `with due as (
       select id, scheduled_for from crm_scheduled_actions
        where status in ('pending', 'due') and scheduled_for <= now()
        order by scheduled_for asc limit $1
          for update skip locked
     ), stuck as (
       select id, scheduled_for from crm_scheduled_actions
        where status = 'executing' and last_attempt_at < now() - interval '15 minutes'
        order by last_attempt_at asc limit $1
          for update skip locked
     )
     update crm_scheduled_actions
        set status = 'executing', last_attempt_at = now()
      where id in (select id from (select * from due union all select * from stuck) s order by scheduled_for asc limit $1)
      returning id`,
    [limit],
  );
  return claimed.rows.map((r) => r.id);
}

/** Fresh context for an executing action, with eligibility checked now. */
export async function getActionContext(db: Queryable, actionId: string): Promise<ActionContext> {
  return buildContext(db, await getActionRowOr404(db, actionId));
}

async function assertExecuting(db: Queryable, actionId: string) {
  const action = await getActionRowOr404(db, actionId);
  if (action.status !== "executing") throw new ConflictError(`Scheduled action is "${action.status}", expected "executing". It may already have been processed.`);
  return action;
}

const automationEvent = (action: ScheduledActionRow, title: string, detail?: string | null) => ({
  dealId: action.deal_id,
  kind: "automation",
  title,
  detail: detail ?? null,
  ...AUTOMATION_ACTOR,
  relatedWorkflowRunId: action.workflow_run_id,
});

/** Applies an ineligible verdict (see Eligibility). */
export async function applyIneligible(db: Queryable, actionId: string, verdict: Exclude<Eligibility, { ok: true }>) {
  const action = await assertExecuting(db, actionId);
  const run = await getRunRowOr404(db, action.workspace_id, action.workflow_run_id);

  if (verdict.kind === "pause") {
    await db.query(`update crm_scheduled_actions set status = 'paused', last_error = $2 where id = $1`, [actionId, verdict.reason]);
    await addTimelineEvent(db, automationEvent(action, "Automation Step Paused", verdict.reason));
    return;
  }
  if (verdict.kind === "defer") {
    await deferAction(db, actionId, verdict.reason, new Date(Date.now() + PAUSED_RETRY_MS));
    return;
  }

  await db.query(`update crm_scheduled_actions set status = 'skipped', last_error = $2 where id = $1`, [actionId, verdict.reason]);
  await addTimelineEvent(db, automationEvent(action, "Automation Step Skipped", verdict.reason));
  if (verdict.reason === NO_TEMPLATE || verdict.reason === INACTIVE_TEMPLATE) {
    await notifyTemplateSkip(db, action, verdict.reason === NO_TEMPLATE ? "missing" : "inactive");
  }
  if (verdict.kind === "stop" && ["running", "waiting"].includes(run.status)) {
    await db.query(`update crm_workflow_runs set status = 'cancelled', cancelled_at = now(), cancel_reason = $2, next_run_at = null where id = $1`, [run.id, verdict.reason]);
    await db.query(
      `update crm_scheduled_actions set status = 'cancelled', cancelled_at = now(), cancel_reason = $2
        where workflow_run_id = $1 and status in ('pending', 'due', 'paused')`,
      [run.id, verdict.reason],
    );
    await addTimelineEvent(db, automationEvent(action, "Workflow Stopped", verdict.reason));
  } else if (verdict.kind === "skip" && ["running", "waiting"].includes(run.status)) {
    await advanceRun(db, run);
  }
}

/** "Workflow X skipped a send: template missing" to the deal owner, or every member when unowned. */
async function notifyTemplateSkip(db: Queryable, action: ScheduledActionRow, problem: "missing" | "inactive") {
  const info = (
    await db.query<{ workflow: string; step_order: number | null; owner_id: string | null; contact_id: string; contact: string }>(
      `select w.name as workflow, ws.step_order, d.owner_id, d.contact_id,
              coalesce(nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.email, 'the contact') as contact
         from crm_workflow_runs r
         join crm_workflows w on w.id = r.workflow_id
         join crm_deals d on d.id = r.deal_id
         join crm_contacts c on c.id = d.contact_id
         left join crm_workflow_steps ws on ws.id = $2
        where r.id = $1`,
      [action.workflow_run_id, action.workflow_step_id],
    )
  ).rows[0];
  if (!info) return;
  const step = info.step_order === null ? "A send step" : `Step ${info.step_order + 1}`;
  await notifyOwnerOrMembers(db, {
    workspaceId: action.workspace_id,
    ownerId: info.owner_id,
    contactId: info.contact_id,
    dealId: action.deal_id,
    title: `Workflow ${info.workflow} skipped a send: template ${problem}`,
    detail: `${step} was not sent to ${info.contact}. ${problem === "missing" ? "Set a template on that step." : "Switch the template back on, or pick another."} The run carried on.`,
    kind: "warning",
    href: `/deals/${action.deal_id}`,
  });
}

/** Back to the queue at retryAt without consuming a retry. */
export async function deferAction(db: Queryable, actionId: string, reason: string, retryAt: Date) {
  await assertExecuting(db, actionId);
  await db.query(
    `update crm_scheduled_actions set status = 'pending', scheduled_for = $2, last_error = $3, last_attempt_at = null where id = $1`,
    [actionId, retryAt.toISOString(), reason],
  );
}

/** Advances `run` past its current step to the next enabled one, or completes it. */
async function advanceRun(db: Queryable, run: RunRow) {
  let afterOrder = -1;
  if (run.current_step_id) {
    afterOrder = (await db.query<{ step_order: number }>(`select step_order from crm_workflow_steps where id = $1`, [run.current_step_id])).rows[0]?.step_order ?? -1;
  }
  const next = await scheduleStepAfter(db, run.workspace_id, run.id, run.deal_id, run.workflow_version_id, afterOrder);
  if (next.stepFound) {
    await db.query(`update crm_workflow_runs set current_step_id = $2, status = $3, next_run_at = $4 where id = $1`, [run.id, next.currentStepId, next.status, next.nextRunAt]);
    await addTimelineEvent(db, { dealId: run.deal_id, kind: "automation", title: "Workflow Advanced", ...AUTOMATION_ACTOR, relatedWorkflowRunId: run.id });
  } else {
    await db.query(`update crm_workflow_runs set current_step_id = null, status = 'completed', completed_at = now(), next_run_at = null where id = $1`, [run.id]);
    await addTimelineEvent(db, { dealId: run.deal_id, kind: "automation", title: "Workflow Completed", ...AUTOMATION_ACTOR, relatedWorkflowRunId: run.id });
  }
  return getRunRowOr404(db, run.workspace_id, run.id);
}

/**
 * Executes create_call_task / create_follow_up_task / change_lead_stage / stop_workflow, then
 * advances the run. Callers check eligibility first (the runner always does).
 */
export async function executeInternalAction(db: Queryable, actionId: string) {
  const action = await assertExecuting(db, actionId);
  if (!INTERNAL_ACTION_TYPES.includes(action.action_type)) throw new ConflictError(`Action type "${action.action_type}" is not an internal action.`);
  const run = await getRunRowOr404(db, action.workspace_id, action.workflow_run_id);
  const deal = await getDealOr404(db, action.workspace_id, action.deal_id);
  const config = ((action.payload as { config?: string | null }).config ?? null)?.trim() || null;

  if (action.action_type === "create_call_task" || action.action_type === "create_follow_up_task") {
    const taskType: TaskType = action.action_type === "create_call_task" ? "call" : "follow_up";
    await createTask(db, null, action.workspace_id, {
      dealId: deal.id,
      ownerId: deal.owner_id,
      type: taskType,
      title: config ?? (taskType === "call" ? "Follow-up call" : "Follow-up task"),
      dueAt: new Date().toISOString(),
      origin: "automation",
      sourceWorkflowRunId: run.id,
      sourceWorkflowStepId: action.workflow_step_id,
    });
  } else if (action.action_type === "change_lead_stage") {
    if (!config) throw new ValidationError("This change_lead_stage step has no target stage configured.");
    assertValidPipelineStage(config);
    await updateDeal(db, null, action.workspace_id, deal.id, { stage: config });
  } else if (action.action_type === "stop_workflow") {
    await db.query(`update crm_workflow_runs set status = 'completed', completed_at = now(), next_run_at = null where id = $1`, [run.id]);
    await db.query(
      `update crm_scheduled_actions set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Workflow stopped by Stop Workflow step'
        where workflow_run_id = $1 and status in ('pending', 'due', 'paused')`,
      [run.id],
    );
    await addTimelineEvent(db, automationEvent(action, "Workflow Stopped", "Stop Workflow step executed"));
  }

  await db.query(`update crm_scheduled_actions set status = 'completed', executed_at = now() where id = $1`, [actionId]);
  const current = await getRunRowOr404(db, action.workspace_id, run.id);
  if (action.action_type !== "stop_workflow" && ["running", "waiting"].includes(current.status)) await advanceRun(db, current);
}

export interface RecordResultInput {
  outcome: "success" | "failure" | "deferred";
  providerMessageId?: string;
  providerResponse?: unknown;
  error?: string;
  retryable?: boolean;
  retryAt?: Date;
}

/** Outcome of a send_email / send_whatsapp. Success advances the run; failure applies retry/backoff. */
export async function recordActionResult(db: Queryable, actionId: string, input: RecordResultInput) {
  const action = await assertExecuting(db, actionId);
  if (!MESSAGE_ACTION_TYPES.includes(action.action_type)) throw new ConflictError(`"${action.action_type}" is not a message action.`);
  const run = await getRunRowOr404(db, action.workspace_id, action.workflow_run_id);

  if (input.outcome === "deferred") {
    await deferAction(db, actionId, input.error ?? "Provider is temporarily unavailable.", input.retryAt ?? new Date(Date.now() + 60_000));
    return;
  }

  if (input.outcome === "success") {
    const dryRun = input.providerMessageId === "DRY_RUN";
    await db.query(`update crm_scheduled_actions set status = 'completed', executed_at = now(), last_error = null where id = $1`, [actionId]);
    await addTimelineEvent(db, {
      dealId: action.deal_id,
      kind: action.action_type === "send_email" ? "email" : "whatsapp",
      title: `${action.action_type === "send_email" ? "Email Sent" : "WhatsApp Sent"}${dryRun ? " (dry run)" : ""}`,
      detail: input.providerMessageId && !dryRun ? `Provider message id: ${input.providerMessageId}` : null,
      ...AUTOMATION_ACTOR,
      relatedWorkflowRunId: run.id,
      metadata: input.providerResponse ? { providerResponse: input.providerResponse } : null,
    });
    if (["running", "waiting"].includes(run.status)) await advanceRun(db, run);
    return;
  }

  const attemptCount = action.attempt_count + 1;
  if (input.retryable !== false && attemptCount < action.max_attempts) {
    const backoffMinutes = Math.min(15 * 2 ** (attemptCount - 1), 240); // 15m, 30m, 60m, ... capped at 4h
    await db.query(`update crm_scheduled_actions set status = 'pending', attempt_count = $2, last_error = $3, scheduled_for = $4 where id = $1`, [
      actionId,
      attemptCount,
      input.error ?? null,
      new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
    ]);
    await addTimelineEvent(db, automationEvent(action, "Automation Step Failed - Retry Scheduled", input.error));
    return;
  }
  await db.query(`update crm_scheduled_actions set status = 'failed', attempt_count = $2, last_error = $3 where id = $1`, [actionId, attemptCount, input.error ?? "Failed"]);
  await db.query(`update crm_workflow_runs set status = 'failed', last_error = $2 where id = $1`, [run.id, input.error ?? "Automation step failed"]);
  await addTimelineEvent(db, automationEvent(action, "Workflow Failed", input.error));
}
