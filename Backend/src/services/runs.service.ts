import type { Queryable } from "../dto.js";
import type { Actor } from "../authMiddleware.js";
import { ConflictError, NotFoundError } from "../errors.js";
import type { AutomationMode, LifecycleState, WorkflowRunStatus, WorkflowStepAction, WorkflowTrigger } from "../domain/enums.js";
import { isTerminalLifecycle } from "../domain/pipeline.js";
import { addTimelineEvent, actorEvent, AUTOMATION_ACTOR } from "./timeline.service.js";
import { findActiveWorkflowsForTrigger, getWorkflowRowOr404 } from "./workflows.service.js";

export interface RunRow {
  id: string;
  workspace_id: string;
  workflow_id: string;
  workflow_version_id: string;
  lead_id: string;
  current_step_id: string | null;
  status: WorkflowRunStatus;
  started_at: Date;
  next_run_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export function runToDto(row: RunRow, versionNumber: number) {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    version: versionNumber,
    leadId: row.lead_id,
    currentStep: row.current_step_id ?? undefined,
    status: row.status,
    startedAt: row.started_at.toISOString(),
    nextRunAt: row.next_run_at?.toISOString(),
    completedAt: row.completed_at?.toISOString(),
    cancelledAt: row.cancelled_at?.toISOString(),
    cancelReason: row.cancel_reason ?? undefined,
    lastError: row.last_error ?? undefined,
  };
}

const RUN_SELECT = `
  select r.*, wv.version_number
    from public.workflow_runs r
    join public.workflow_versions wv on wv.id = r.workflow_version_id
`;

export async function getRunRowOr404(db: Queryable, workspaceId: string, id: string) {
  const result = await db.query<RunRow & { version_number: number }>(`${RUN_SELECT} where r.id = $1 and r.workspace_id = $2`, [id, workspaceId]);
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Workflow run");
  return row;
}

export interface ListRunsFilters {
  workflowId?: string;
  leadId?: string;
  status?: WorkflowRunStatus;
}

export async function listRuns(db: Queryable, workspaceId: string, filters: ListRunsFilters) {
  const clauses: string[] = [`r.workspace_id = $1`];
  const params: unknown[] = [workspaceId];
  let i = 2;
  if (filters.workflowId) {
    clauses.push(`r.workflow_id = $${i++}`);
    params.push(filters.workflowId);
  }
  if (filters.leadId) {
    clauses.push(`r.lead_id = $${i++}`);
    params.push(filters.leadId);
  }
  if (filters.status) {
    clauses.push(`r.status = $${i++}`);
    params.push(filters.status);
  }
  const where = `where ${clauses.join(" and ")}`;
  const result = await db.query<RunRow & { version_number: number }>(
    `${RUN_SELECT} ${where} order by r.started_at desc`,
    params,
  );
  return result.rows.map((r) => runToDto(r, r.version_number));
}

interface StepForScheduling {
  id: string;
  step_order: number;
  delay_days: number;
  action: WorkflowStepAction;
  template_id: string | null;
  config: string | null;
}

/**
 * The next enabled step after a given order — afterOrder = -1 finds the
 * first enabled step of the version. Shared by enrollment (autoEnroll,
 * afterOrder -1) and post-execution progression (automation.service's
 * advanceRun, afterOrder = the just-completed step's order), so "what runs
 * next" is computed by exactly one query regardless of caller.
 */
async function nextEnabledStep(db: Queryable, versionId: string, afterOrder = -1): Promise<StepForScheduling | undefined> {
  const result = await db.query<StepForScheduling>(
    `select id, step_order, delay_days, action, template_id, config
       from public.workflow_steps
      where workflow_version_id = $1 and is_enabled = true and step_order > $2
      order by step_order asc
      limit 1`,
    [versionId, afterOrder],
  );
  return result.rows[0];
}

async function insertScheduledAction(db: Queryable, workspaceId: string, runId: string, leadId: string, step: StepForScheduling) {
  const scheduledFor = new Date();
  scheduledFor.setUTCDate(scheduledFor.getUTCDate() + step.delay_days);

  await db.query(
    `insert into public.scheduled_actions
      (workspace_id, lead_id, workflow_run_id, workflow_step_id, action_type, scheduled_for, payload)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      workspaceId,
      leadId,
      runId,
      step.id,
      step.action,
      scheduledFor.toISOString(),
      JSON.stringify({ templateId: step.template_id, config: step.config }),
    ],
  );

  return scheduledFor;
}

async function scheduleFirstStep(db: Queryable, workspaceId: string, runId: string, leadId: string, versionId: string) {
  const step = await nextEnabledStep(db, versionId);
  if (!step) {
    // No enabled steps to run — nothing to schedule; the run stays
    // "running" with no current step, which is a harmless no-op state.
    return { currentStepId: null as string | null, status: "running" as WorkflowRunStatus, nextRunAt: null as Date | null };
  }

  const scheduledFor = await insertScheduledAction(db, workspaceId, runId, leadId, step);
  const status: WorkflowRunStatus = step.delay_days > 0 ? "waiting" : "running";
  return { currentStepId: step.id, status, nextRunAt: scheduledFor };
}

/**
 * Progression after a step has actually executed (called by
 * automation.service once the executor reports a result): finds the next
 * enabled step of the SAME workflow_version the run is already on (a run
 * never jumps versions — Rule 11) and schedules it, or reports that the run
 * has naturally finished (no more enabled steps) so the caller can complete
 * it. Unlike scheduleFirstStep, running out of steps here is success, not a
 * harmless no-op — the sequence the lead was enrolled in is done. Takes
 * workspaceId (not re-derived here) since automation.service already has it
 * on hand from the scheduled_action row it's advancing.
 */
export async function scheduleStepAfter(db: Queryable, workspaceId: string, runId: string, leadId: string, versionId: string, afterOrder: number) {
  const step = await nextEnabledStep(db, versionId, afterOrder);
  if (!step) {
    return { currentStepId: null as string | null, status: "completed" as WorkflowRunStatus, nextRunAt: null as Date | null, stepFound: false as const };
  }

  const scheduledFor = await insertScheduledAction(db, workspaceId, runId, leadId, step);
  const status: WorkflowRunStatus = step.delay_days > 0 ? "waiting" : "running";
  return { currentStepId: step.id, status, nextRunAt: scheduledFor, stepFound: true as const };
}

/**
 * Enrolling a lead in a workflow means nothing fires unless the lead's
 * automation is actually on — so enrollment always turns it on. Deliberately
 * does NOT import setAutomationMode from leads.service.ts: that module
 * already imports applyAutomationModeToRuns from this one, and importing
 * back would create a circular dependency between the two files. Mirrors
 * setAutomationMode's own update + timeline event + cascade inline instead,
 * using the same terminal-lifecycle guard (isTerminalLifecycle) so a
 * won/lost/discarded/do_not_contact/merged lead's automation is never
 * resurrected by an enrollment call.
 */
async function activateAutomationForEnrollment(db: Queryable, leadId: string, reason: string) {
  const result = await db.query<{ automation_mode: AutomationMode; lifecycle_state: LifecycleState }>(
    `select automation_mode, lifecycle_state from public.leads where id = $1`,
    [leadId],
  );
  const lead = result.rows[0];
  if (!lead || lead.automation_mode === "active" || isTerminalLifecycle(lead.lifecycle_state)) return;

  await db.query(`update public.leads set automation_mode = 'active', last_activity_at = now() where id = $1`, [leadId]);
  await addTimelineEvent(db, { leadId, kind: "automation", title: "Automation Resumed", detail: reason, ...AUTOMATION_ACTOR });
  await applyAutomationModeToRuns(db, leadId, "active", reason);
}

/**
 * Enrolls a lead in one specific workflow version: creates the run and
 * schedules its first step, or returns null if the lead already has a
 * non-terminal run against this workflow (no duplicate enrollment). Shared
 * by autoEnroll (per trigger-matched candidate) and enrollLeadInWorkflow
 * (a salesperson picking an exact workflow by id, regardless of its
 * trigger). Returns the same DTO shape (camelCase, ISO dates) as every other
 * runs endpoint (pause/resume/cancel/retry), not a raw DB row.
 */
async function enrollLeadInVersion(
  db: Queryable,
  workspaceId: string,
  leadId: string,
  workflowId: string,
  versionId: string,
  reason: string,
): Promise<ReturnType<typeof runToDto> | null> {
  const existing = await db.query<{ id: string }>(
    `select id from public.workflow_runs
      where lead_id = $1 and workflow_id = $2 and status in ('running','waiting','paused')`,
    [leadId, workflowId],
  );
  if (existing.rows[0]) return null;

  const runResult = await db.query<RunRow>(
    `insert into public.workflow_runs (workspace_id, workflow_id, workflow_version_id, lead_id, status)
     values ($1,$2,$3,$4,'running') returning *`,
    [workspaceId, workflowId, versionId, leadId],
  );
  const run = runResult.rows[0]!;
  const scheduled = await scheduleFirstStep(db, workspaceId, run.id, leadId, versionId);
  await db.query(
    `update public.workflow_runs set current_step_id = $2, status = $3, next_run_at = $4 where id = $1`,
    [run.id, scheduled.currentStepId, scheduled.status, scheduled.nextRunAt],
  );

  await addTimelineEvent(db, {
    leadId,
    kind: "automation",
    title: "Workflow Enrolled",
    detail: reason,
    ...AUTOMATION_ACTOR,
    relatedWorkflowRunId: run.id,
  });

  await activateAutomationForEnrollment(db, leadId, `Automation activated by workflow enrollment: ${reason}`);

  const full = await getRunRowOr404(db, workspaceId, run.id);
  return runToDto(full, full.version_number);
}

/**
 * The single coherent "enroll a lead in the right workflow" operation
 * (product brief, "WORKFLOW ENROLLMENT"): pick the active workflow(s) for
 * this trigger IN THE LEAD'S OWN WORKSPACE, use each one's latest published
 * version (Rule: new enrollments use the newest published version), create
 * the run, and schedule its first step — or skip quietly if nothing is
 * published yet (there's no workflow configured for that trigger), which is
 * a normal, expected state for a workspace that hasn't built out automation
 * yet. Skips a workflow if the lead already has a non-terminal run against
 * it (no duplicate enrollment).
 */
export async function autoEnroll(
  db: Queryable,
  workspaceId: string,
  leadId: string,
  trigger: WorkflowTrigger,
  reason: string,
) {
  const candidates = await findActiveWorkflowsForTrigger(db, workspaceId, trigger);
  const created: ReturnType<typeof runToDto>[] = [];

  for (const candidate of candidates) {
    const run = await enrollLeadInVersion(db, workspaceId, leadId, candidate.workflow_id, candidate.version_id, reason);
    if (run) created.push(run);
  }

  return created;
}

/**
 * Explicit manual enrollment: a salesperson picking exactly which workflow
 * to put a lead in, regardless of that workflow's configured trigger (unlike
 * autoEnroll, which only matches workflows whose trigger equals the given
 * value). Used by POST /runs when a workflowId is supplied. getWorkflowRowOr404
 * scoping workflowId to workspaceId is what stops a lead from being enrolled
 * in another workspace's workflow.
 */
export async function enrollLeadInWorkflow(
  db: Queryable,
  workspaceId: string,
  leadId: string,
  workflowId: string,
  reason: string,
): Promise<ReturnType<typeof runToDto> | null> {
  const workflow = await getWorkflowRowOr404(db, workspaceId, workflowId);
  if (workflow.status !== "active") {
    throw new ConflictError(`Workflow "${workflow.name}" is not active.`);
  }

  const versionResult = await db.query<{ id: string }>(
    `select id from public.workflow_versions where workflow_id = $1 and status = 'published'`,
    [workflowId],
  );
  const versionId = versionResult.rows[0]?.id;
  if (!versionId) {
    throw new ConflictError(`Workflow "${workflow.name}" has no published version to enroll into.`);
  }

  return enrollLeadInVersion(db, workspaceId, leadId, workflowId, versionId, reason);
}

async function setRunStatus(
  db: Queryable,
  actor: Actor | null,
  run: RunRow,
  status: WorkflowRunStatus,
  timelineTitle: string,
  reason?: string,
  extraSql?: string,
) {
  await db.query(
    `update public.workflow_runs
        set status = $2
            ${status === "cancelled" ? ", cancelled_at = now(), cancel_reason = $3" : ""}
            ${status === "completed" ? ", completed_at = now()" : ""}
            ${extraSql ?? ""}
      where id = $1`,
    status === "cancelled" ? [run.id, status, reason ?? null] : [run.id, status],
  );

  const scheduledActionStatus = status === "paused" ? "paused" : status === "cancelled" ? "cancelled" : "pending";
  if (status === "paused" || status === "cancelled") {
    await db.query(
      `update public.scheduled_actions
          set status = $2 ${status === "cancelled" ? ", cancelled_at = now(), cancel_reason = $3" : ""}
        where workflow_run_id = $1 and status in ('pending','due','paused')`,
      status === "cancelled" ? [run.id, scheduledActionStatus, reason ?? null] : [run.id, scheduledActionStatus],
    );
  } else if (status === "running" || status === "waiting") {
    // Resume: bring paused scheduled actions back to pending. This does NOT
    // change scheduled_for, and does NOT execute anything — there is no
    // executor in this phase, and a future one re-checks eligibility right
    // before it acts (Rule 14), so nothing is "blasted" here (Rule 10).
    await db.query(
      `update public.scheduled_actions set status = 'pending' where workflow_run_id = $1 and status = 'paused'`,
      [run.id],
    );
  }

  const who = actor ? actorEvent(actor) : AUTOMATION_ACTOR;
  await addTimelineEvent(db, {
    leadId: run.lead_id,
    kind: "automation",
    title: timelineTitle,
    detail: reason,
    actorId: who.actorId,
    actorName: who.actorName,
    actorSource: who.actorSource,
    relatedWorkflowRunId: run.id,
  });
}

export async function pauseRun(db: Queryable, actor: Actor, workspaceId: string, id: string, reason?: string) {
  const run = await getRunRowOr404(db, workspaceId, id);
  if (!["running", "waiting"].includes(run.status)) {
    throw new ConflictError(`Cannot pause a run with status "${run.status}".`);
  }
  await setRunStatus(db, actor, run, "paused", "Workflow Paused", reason);
  const updated = await getRunRowOr404(db, workspaceId, id);
  return runToDto(updated, updated.version_number);
}

export async function resumeRun(db: Queryable, actor: Actor, workspaceId: string, id: string) {
  const run = await getRunRowOr404(db, workspaceId, id);
  if (run.status !== "paused") {
    throw new ConflictError(`Cannot resume a run with status "${run.status}".`);
  }
  const nextStatus: WorkflowRunStatus = run.next_run_at && run.next_run_at > new Date() ? "waiting" : "running";
  await setRunStatus(db, actor, run, nextStatus, "Workflow Resumed");
  const updated = await getRunRowOr404(db, workspaceId, id);
  return runToDto(updated, updated.version_number);
}

export async function cancelRun(db: Queryable, actor: Actor, workspaceId: string, id: string, reason?: string) {
  const run = await getRunRowOr404(db, workspaceId, id);
  if (["completed", "cancelled"].includes(run.status)) return runToDto(run, run.version_number);
  await setRunStatus(db, actor, run, "cancelled", "Workflow Cancelled", reason ?? "Cancelled by salesperson");
  const updated = await getRunRowOr404(db, workspaceId, id);
  return runToDto(updated, updated.version_number);
}

export async function retryRun(db: Queryable, actor: Actor, workspaceId: string, id: string) {
  const run = await getRunRowOr404(db, workspaceId, id);
  if (run.status !== "failed") throw new ConflictError(`Cannot retry a run with status "${run.status}".`);

  await db.query(`update public.workflow_runs set status = 'waiting', last_error = null where id = $1`, [id]);
  await db.query(
    `update public.scheduled_actions
        set status = 'pending', attempt_count = 0, last_error = null
      where workflow_run_id = $1 and status = 'failed'`,
    [id],
  );
  // A salesperson clicking "Retry" means "try again now" — the failed
  // action's scheduled_for is already in the past, so the worker's next
  // poll picks it up.
  await addTimelineEvent(db, { leadId: run.lead_id, kind: "automation", title: "Workflow Retried", ...actorEvent(actor), relatedWorkflowRunId: run.id });
  const updated = await getRunRowOr404(db, workspaceId, id);
  return runToDto(updated, updated.version_number);
}

/**
 * Bulk cascade driven by the lead-level automation switch (Rules 9/10).
 * mode='paused' pauses in-flight runs; mode='active' resumes paused ones;
 * mode='manual'|'stopped' cancels everything non-terminal — manual means
 * the salesperson takes over, so automated customer-facing runs must stop.
 * Takes leadId only (no workspaceId): every caller already has a
 * workspace-validated lead in hand (see leads.service.ts's
 * getLeadRowOr404-first pattern).
 */
export async function applyAutomationModeToRuns(db: Queryable, leadId: string, mode: AutomationMode, reason: string) {
  const runs = await db.query<RunRow & { version_number: number }>(
    `${RUN_SELECT} where r.lead_id = $1 and r.status in ('running','waiting','paused')`,
    [leadId],
  );

  for (const run of runs.rows) {
    if (mode === "paused" && run.status !== "paused") {
      await setRunStatus(db, null, run, "paused", "Workflow Paused", reason);
    } else if (mode === "active" && run.status === "paused") {
      const nextStatus: WorkflowRunStatus = run.next_run_at && run.next_run_at > new Date() ? "waiting" : "running";
      await setRunStatus(db, null, run, nextStatus, "Workflow Resumed", reason);
    } else if (mode === "manual" || mode === "stopped") {
      await setRunStatus(db, null, run, "cancelled", "Workflow Cancelled", reason);
    }
  }
}

/** Takes leadId only, for the same reason as applyAutomationModeToRuns above. */
export async function cancelRunsForLead(db: Queryable, leadId: string, reason: string) {
  const runs = await db.query<RunRow & { version_number: number }>(
    `${RUN_SELECT} where r.lead_id = $1 and r.status not in ('completed','cancelled')`,
    [leadId],
  );
  for (const run of runs.rows) {
    await setRunStatus(db, null, run, "cancelled", "Workflow Cancelled", reason);
  }
}

export interface ScheduledActionRow {
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
  last_error: string | null;
  executed_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
}

export interface ListScheduledActionsFilters {
  leadId?: string;
  workflowRunId?: string;
  status?: string;
}

export async function listScheduledActions(db: Queryable, workspaceId: string, filters: ListScheduledActionsFilters) {
  const clauses: string[] = [`workspace_id = $1`];
  const params: unknown[] = [workspaceId];
  let i = 2;
  if (filters.leadId) {
    clauses.push(`lead_id = $${i++}`);
    params.push(filters.leadId);
  }
  if (filters.workflowRunId) {
    clauses.push(`workflow_run_id = $${i++}`);
    params.push(filters.workflowRunId);
  }
  if (filters.status) {
    clauses.push(`status = $${i++}`);
    params.push(filters.status);
  }
  const where = `where ${clauses.join(" and ")}`;
  const result = await db.query<ScheduledActionRow>(
    `select * from public.scheduled_actions ${where} order by scheduled_for asc`,
    params,
  );
  return result.rows.map((r) => ({
    id: r.id,
    leadId: r.lead_id,
    workflowRunId: r.workflow_run_id,
    workflowStepId: r.workflow_step_id,
    actionType: r.action_type,
    scheduledFor: r.scheduled_for.toISOString(),
    status: r.status,
    payload: r.payload,
    attemptCount: r.attempt_count,
    maxAttempts: r.max_attempts,
    lastError: r.last_error ?? undefined,
    executedAt: r.executed_at?.toISOString(),
    cancelledAt: r.cancelled_at?.toISOString(),
    cancelReason: r.cancel_reason ?? undefined,
  }));
}
