import type { Queryable } from "../dto.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors.js";
import type { WorkflowStepAction, WorkflowRunStatus, TaskType } from "../domain/enums.js";
import { assertPipelineStageEditable, assertValidPipelineStage } from "../domain/pipeline.js";
import { addTimelineEvent, AUTOMATION_ACTOR } from "./timeline.service.js";
import { getRunRowOr404, scheduleStepAfter, type RunRow } from "./runs.service.js";
import { getDealOr404, type DealRow } from "./deals.service.js";
import { canRunAutomation } from "../domain/pipeline.js";
import { createTask } from "./tasks.service.js";
import { getLatestMeetingForDeal, toRenderMeeting } from "./meetings.service.js";
import type { TemplateRenderMeeting } from "../domain/templateRenderer.js";

/**
 * This module is the ONLY place business rules run for automation
 * execution — src/worker.ts (the in-process automation executor) calls
 * these functions and acts on the result; it never decides what a step
 * means, what template/delay/stage applies, or what happens next itself.
 */

const MESSAGE_ACTION_TYPES: WorkflowStepAction[] = ["send_email", "send_whatsapp"];
const INTERNAL_ACTION_TYPES: WorkflowStepAction[] = ["create_call_task", "create_follow_up_task", "change_lead_stage", "stop_workflow"];

interface ScheduledActionRow {
  id: string;
  workspace_id: string;
  lead_id: string;
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
  const result = await db.query<ScheduledActionRow>(`select * from public.scheduled_actions where id = $1`, [id]);
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

export interface Eligibility {
  ok: boolean;
  reason?: string;
}

function computeEligibility(
  action: ScheduledActionRow,
  lead: DealRow,
  run: RunRow,
  template: TemplateRow | null,
  contactStatus: string | undefined,
): Eligibility {
  if (!["running", "waiting"].includes(run.status)) {
    return { ok: false, reason: `Workflow run status is "${run.status}".` };
  }
  if (!canRunAutomation(lead.outcome, lead.contact_status)) {
    return { ok: false, reason: `Deal is "${lead.outcome}" and contact is "${lead.contact_status}".` };
  }
  if (["paused", "manual", "stopped"].includes(lead.automation_mode)) {
    return { ok: false, reason: `Lead automation mode is "${lead.automation_mode}".` };
  }

  if (action.action_type === "send_email") {
    if (!lead.email) return { ok: false, reason: "Lead has no email address." };
    if (contactStatus && ["permanent_bounce", "unsubscribed", "invalid"].includes(contactStatus)) {
      return { ok: false, reason: `Email contactability is "${contactStatus}".` };
    }
    if (!template) return { ok: false, reason: "No email template resolved for this step." };
    if (!template.is_active) return { ok: false, reason: "Email template is inactive." };
  }

  if (action.action_type === "send_whatsapp") {
    if (!lead.phone_e164) return { ok: false, reason: "Lead has no valid normalized phone number." };
    if (contactStatus && ["invalid", "opted_out", "do_not_contact"].includes(contactStatus)) {
      return { ok: false, reason: `WhatsApp contactability is "${contactStatus}".` };
    }
    if (!template) return { ok: false, reason: "No WhatsApp template resolved for this step." };
    if (!template.is_active) return { ok: false, reason: "WhatsApp template is inactive." };
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
  lead: {
    id: string;
    firstName: string;
    lastName: string;
    company: string;
    industry: string | null;
    email: string | null;
    phone: string | null;
    phoneE164: string | null;
    ownerId: string | null;
    ownerName: string | null;
    stage: string;
    lifecycleState: string;
    automationMode: string;
    responseState: string;
  };
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
  const leadRow = await getDealOr404(db, action.workspace_id, action.lead_id);
  const lead = leadRow as DealRow & { owner_name: string | null };

  const stepResult = await db.query<StepRow>(
    `select id, step_order, delay_days, action, config, template_id from public.workflow_steps where id = $1`,
    [action.workflow_step_id],
  );
  const step = stepResult.rows[0] ?? null;

  const templateId = (action.payload as { templateId?: string | null }).templateId ?? step?.template_id ?? null;
  let template: TemplateRow | null = null;
  let templateAttachments: { id: string; storagePath: string; fileName: string; mimeType: string }[] = [];
  if (templateId) {
    const templateResult = await db.query<TemplateRow>(
      `select id, name, channel, subject, body, is_active from public.message_templates where id = $1`,
      [templateId],
    );
    template = templateResult.rows[0] ?? null;
    if (template) {
      const attachmentsResult = await db.query<{ id: string; storage_path: string; file_name: string; mime_type: string }>(
        `select id, storage_path, file_name, mime_type from public.template_attachments where template_id = $1 order by created_at asc`,
        [templateId],
      );
      templateAttachments = attachmentsResult.rows.map((row) => ({
        id: row.id,
        storagePath: row.storage_path,
        fileName: row.file_name,
        mimeType: row.mime_type,
      }));
    }
  }

  let contactStatus: string | undefined;
  let meeting: TemplateRenderMeeting | null = null;
  if (action.action_type === "send_email" || action.action_type === "send_whatsapp") {
    const channel = action.action_type === "send_email" ? "email" : "whatsapp";
    const contactResult = await db.query<{ status: string }>(
      `select status from public.lead_contact_channels where lead_id = $1 and channel = $2`,
      [lead.id, channel],
    );
    contactStatus = contactResult.rows[0]?.status;

    const meetingRow = await getLatestMeetingForDeal(db, lead.id);
    meeting = meetingRow ? toRenderMeeting(meetingRow) : null;
  }

  const eligibility = computeEligibility(action, lead, run, template, contactStatus);

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
    lead: {
      id: lead.id,
      firstName: lead.first_name,
      lastName: lead.last_name,
      company: lead.company_name ?? "",
      industry: lead.industry,
      email: lead.email,
      phone: lead.phone,
      phoneE164: lead.phone_e164,
      ownerId: lead.owner_id,
      ownerName: lead.owner_name ?? null,
      stage: lead.stage,
      lifecycleState: lead.outcome,
      automationMode: lead.automation_mode,
      responseState: lead.response_state,
    },
    run: { id: run.id, workflowId: run.workflow_id, status: run.status, currentStepId: run.current_step_id },
    step: step ? { id: step.id, order: step.step_order, delayDays: step.delay_days, action: step.action, config: step.config } : null,
    template: template
      ? {
          id: template.id,
          name: template.name,
          channel: template.channel,
          subject: template.subject,
          body: template.body,
          attachments: templateAttachments,
        }
      : null,
    meeting,
    eligibility,
  };
}

/**
 * Concurrency-safe claim: a single UPDATE ... WHERE id IN (SELECT ... FOR
 * UPDATE SKIP LOCKED) is atomic, so two worker poll ticks racing on the same
 * rows can never both claim the same one — the loser's SELECT simply skips
 * rows the winner already locked. Also reclaims rows stuck in 'executing'
 * for >15 minutes (a crashed worker process never reported back), so a
 * crash can't strand an action forever.
 */
export async function claimDueActions(db: Queryable, limit: number): Promise<ActionContext[]> {
  const claimed = await db.query<ScheduledActionRow>(
    `update public.scheduled_actions
        set status = 'executing', last_attempt_at = now()
      where id in (
        select id from public.scheduled_actions
         where (status in ('pending', 'due') and scheduled_for <= now())
            or (status = 'executing' and last_attempt_at < now() - interval '15 minutes')
         order by scheduled_for asc
         limit $1
         for update skip locked
      )
      returning *`,
    [limit],
  );

  const out: ActionContext[] = [];
  for (const row of claimed.rows) {
    out.push(await buildContext(db, row));
  }
  return out;
}

export async function getActionContext(db: Queryable, actionId: string): Promise<ActionContext> {
  const action = await getActionRowOr404(db, actionId);
  return buildContext(db, action);
}

export async function skipAction(db: Queryable, actionId: string, reason: string) {
  const action = await getActionRowOr404(db, actionId);
  if (action.status !== "executing") {
    throw new ConflictError(`Scheduled action is "${action.status}", expected "executing".`);
  }
  const run = await getRunRowOr404(db, action.workspace_id, action.workflow_run_id);
  if (run.status === "paused") {
    await db.query(`update public.scheduled_actions set status = 'paused', last_error = $2 where id = $1`, [actionId, reason]);
    await addTimelineEvent(db, {
      dealId: action.lead_id,
      kind: "automation",
      title: "Automation Step Paused",
      detail: reason,
      ...AUTOMATION_ACTOR,
      relatedWorkflowRunId: action.workflow_run_id,
    });
    return getActionContext(db, actionId);
  }
  await db.query(`update public.scheduled_actions set status = 'skipped', last_error = $2 where id = $1`, [actionId, reason]);
  await addTimelineEvent(db, {
    dealId: action.lead_id,
    kind: "automation",
    title: "Automation Step Skipped",
    detail: reason,
    ...AUTOMATION_ACTOR,
    relatedWorkflowRunId: action.workflow_run_id,
  });
  if (["running", "waiting"].includes(run.status)) {
    await advanceRun(db, run);
  }
  return getActionContext(db, actionId);
}

/** Return a provider-blocked action to the queue without consuming a retry. */
export async function deferAction(db: Queryable, actionId: string, reason: string, retryAt: Date) {
  const action = await getActionRowOr404(db, actionId);
  if (action.status !== "executing") {
    throw new ConflictError(`Scheduled action is "${action.status}", expected "executing".`);
  }
  await db.query(
    `update public.scheduled_actions
        set status = 'pending', scheduled_for = $2, last_error = $3, last_attempt_at = null
      where id = $1`,
    [actionId, retryAt.toISOString(), reason],
  );
}

/** Shared progression step: advance `run` past its current step to the next enabled one, or complete it. */
async function advanceRun(db: Queryable, run: RunRow) {
  let afterOrder = -1;
  if (run.current_step_id) {
    const stepResult = await db.query<{ step_order: number }>(`select step_order from public.workflow_steps where id = $1`, [run.current_step_id]);
    afterOrder = stepResult.rows[0]?.step_order ?? -1;
  }

  const result = await scheduleStepAfter(db, run.workspace_id, run.id, run.deal_id, run.workflow_version_id, afterOrder);

  if (result.stepFound) {
    await db.query(
      `update public.workflow_runs set current_step_id = $2, status = $3, next_run_at = $4 where id = $1`,
      [run.id, result.currentStepId, result.status, result.nextRunAt],
    );
    await addTimelineEvent(db, { dealId: run.deal_id, kind: "automation", title: "Workflow Advanced", ...AUTOMATION_ACTOR, relatedWorkflowRunId: run.id });
  } else {
    await db.query(
      `update public.workflow_runs set current_step_id = null, status = 'completed', completed_at = now(), next_run_at = null where id = $1`,
      [run.id],
    );
    await addTimelineEvent(db, { dealId: run.deal_id, kind: "automation", title: "Workflow Completed", ...AUTOMATION_ACTOR, relatedWorkflowRunId: run.id });
  }

  return getRunRowOr404(db, run.workspace_id, run.id);
}

/**
 * Executes create_call_task / create_follow_up_task / change_lead_stage /
 * stop_workflow directly against backend business operations, then advances
 * the run. Idempotent-safe to retry: it only mutates once action.status is
 * 'executing' and flips it to 'completed' in the same statement set, so a
 * network-level retry of an already-completed call fails fast at the status
 * guard below instead of double-applying.
 */
export async function executeInternalAction(db: Queryable, actionId: string) {
  const action = await getActionRowOr404(db, actionId);
  if (!INTERNAL_ACTION_TYPES.includes(action.action_type)) {
    throw new ConflictError(`Action type "${action.action_type}" is not an internal action - report it via POST /automation/actions/:id/result instead.`);
  }
  if (action.status !== "executing") {
    throw new ConflictError(`Scheduled action is "${action.status}", expected "executing". It may already have been processed.`);
  }

  const run = await getRunRowOr404(db, action.workspace_id, action.workflow_run_id);
  const leadRow = await getDealOr404(db, action.workspace_id, action.lead_id);
  const lead = leadRow as DealRow & { owner_name: string | null };

  if (!canRunAutomation(lead.outcome, lead.contact_status) || !["running", "waiting"].includes(run.status)) {
    const reason = `Deal/run no longer eligible at execution time (deal=${lead.outcome}, contact=${lead.contact_status}, run=${run.status}).`;
    const context = await skipAction(db, actionId, reason);
    return { action: context.action, run: await getRunRowOr404(db, action.workspace_id, run.id), skipped: true };
  }

  const config = ((action.payload as { config?: string | null }).config ?? null)?.trim() || null;

  if (action.action_type === "create_call_task" || action.action_type === "create_follow_up_task") {
    const taskType: TaskType = action.action_type === "create_call_task" ? "call" : "follow_up";
    await createTask(db, null, action.workspace_id, {
      dealId: lead.id,
      ownerId: lead.owner_id,
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
    assertPipelineStageEditable(lead.outcome);
    await db.query(`update public.leads set pipeline_stage = $2, last_activity_at = now() where id = $1`, [lead.id, config]);
    await addTimelineEvent(db, { dealId: lead.id, kind: "stage", title: `Stage changed to ${config}`, ...AUTOMATION_ACTOR, relatedWorkflowRunId: run.id });
  } else if (action.action_type === "stop_workflow") {
    await db.query(`update public.workflow_runs set status = 'completed', completed_at = now(), next_run_at = null where id = $1`, [run.id]);
    await db.query(
      `update public.scheduled_actions
          set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Workflow stopped by Stop Workflow step'
        where workflow_run_id = $1 and status in ('pending', 'due', 'paused')`,
      [run.id],
    );
    await addTimelineEvent(db, { dealId: lead.id, kind: "automation", title: "Workflow Stopped", detail: "Stop Workflow step executed", ...AUTOMATION_ACTOR, relatedWorkflowRunId: run.id });
  }

  await db.query(`update public.scheduled_actions set status = 'completed', executed_at = now() where id = $1`, [actionId]);

  let finalRun = await getRunRowOr404(db, action.workspace_id, run.id);
  if (action.action_type !== "stop_workflow" && !["completed", "cancelled", "failed"].includes(finalRun.status)) {
    finalRun = await advanceRun(db, finalRun);
  }

  return { action: (await getActionContext(db, actionId)).action, run: finalRun, skipped: false };
}

export interface RecordResultInput {
  outcome: "success" | "failure" | "deferred";
  providerMessageId?: string;
  providerResponse?: unknown;
  error?: string;
  retryable?: boolean;
  retryAt?: Date;
}

/**
 * Reports the outcome of an external send (send_email / send_whatsapp — the
 * only action types the worker sends directly). On success, advances the
 * run exactly like executeInternalAction does. On failure, applies backend-
 * owned retry/backoff.
 */
export async function recordActionResult(db: Queryable, actionId: string, input: RecordResultInput) {
  const action = await getActionRowOr404(db, actionId);
  if (action.status !== "executing") {
    throw new ConflictError(`Scheduled action is "${action.status}", expected "executing".`);
  }
  if (input.outcome === "success" && !MESSAGE_ACTION_TYPES.includes(action.action_type)) {
    throw new ConflictError(`"${action.action_type}" must report success via POST /automation/actions/:id/execute-internal, not /result.`);
  }

  const run = await getRunRowOr404(db, action.workspace_id, action.workflow_run_id);

  if (input.outcome === "deferred") {
    await deferAction(db, actionId, input.error ?? "Provider is temporarily unavailable.", input.retryAt ?? new Date(Date.now() + 60_000));
    return { action: (await getActionContext(db, actionId)).action, run };
  }

  if (input.outcome === "success") {
    await db.query(`update public.scheduled_actions set status = 'completed', executed_at = now(), last_error = null where id = $1`, [actionId]);
    await addTimelineEvent(db, {
      dealId: action.lead_id,
      kind: action.action_type === "send_email" ? "email" : "whatsapp",
      title: action.action_type === "send_email" ? "Email Sent" : "WhatsApp Sent",
      detail: input.providerMessageId ? `Provider message id: ${input.providerMessageId}` : undefined,
      ...AUTOMATION_ACTOR,
      relatedWorkflowRunId: run.id,
      metadata: input.providerResponse ? { providerResponse: input.providerResponse } : null,
    });

    if (["completed", "cancelled", "failed"].includes(run.status)) {
      return { action: (await getActionContext(db, actionId)).action, run };
    }
    const advanced = await advanceRun(db, run);
    return { action: (await getActionContext(db, actionId)).action, run: advanced };
  }

  // outcome === "failure"
  const attemptCount = action.attempt_count + 1;
  const willRetry = input.retryable !== false && attemptCount < action.max_attempts;

  if (willRetry) {
    const backoffMinutes = Math.min(15 * 2 ** (attemptCount - 1), 240); // 15m, 30m, 60m, 120m, capped 4h
    const nextAttemptAt = new Date(Date.now() + backoffMinutes * 60_000);
    await db.query(
      `update public.scheduled_actions set status = 'pending', attempt_count = $2, last_error = $3, scheduled_for = $4 where id = $1`,
      [actionId, attemptCount, input.error ?? null, nextAttemptAt.toISOString()],
    );
    await addTimelineEvent(db, {
      dealId: action.lead_id,
      kind: "automation",
      title: "Automation Step Failed - Retry Scheduled",
      detail: input.error,
      ...AUTOMATION_ACTOR,
      relatedWorkflowRunId: run.id,
    });
    return { action: (await getActionContext(db, actionId)).action, run };
  }

  await db.query(`update public.scheduled_actions set status = 'failed', attempt_count = $2, last_error = $3 where id = $1`, [actionId, attemptCount, input.error ?? null]);
  await db.query(`update public.workflow_runs set status = 'failed', last_error = $2 where id = $1`, [run.id, input.error ?? "Automation step failed"]);
  await addTimelineEvent(db, {
    dealId: action.lead_id,
    kind: "automation",
    title: "Workflow Failed",
    detail: input.error,
    ...AUTOMATION_ACTOR,
    relatedWorkflowRunId: run.id,
  });
  return { action: (await getActionContext(db, actionId)).action, run: await getRunRowOr404(db, action.workspace_id, run.id) };
}

