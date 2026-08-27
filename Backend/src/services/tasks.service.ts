import type { Queryable } from "../dto.js";
import type { Actor } from "../authMiddleware.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors.js";
import { addTimelineEvent, actorEvent, AUTOMATION_ACTOR } from "./timeline.service.js";
import type { TaskType } from "../domain/enums.js";

export interface TaskRow {
  id: string;
  lead_id: string;
  owner_id: string | null;
  owner_name: string | null;
  task_type: TaskType;
  title: string;
  due_at: Date;
  status: "open" | "completed" | "cancelled";
  origin: "manual" | "automation";
  created_by: string | null;
  created_by_name: string | null;
  source_workflow_run_id: string | null;
  source_workflow_step_id: string | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export function taskToDto(row: TaskRow) {
  return {
    id: row.id,
    leadId: row.lead_id,
    ownerId: row.owner_id ?? undefined,
    ownerName: row.owner_name ?? undefined,
    type: row.task_type,
    title: row.title,
    dueAt: row.due_at.toISOString(),
    status: row.status,
    done: row.status === "completed",
    origin: row.origin,
    sourceWorkflowRunId: row.source_workflow_run_id ?? undefined,
    completedAt: row.completed_at?.toISOString(),
    cancelledAt: row.cancelled_at?.toISOString(),
    cancelReason: row.cancel_reason ?? undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface CreateTaskInput {
  leadId: string;
  ownerId?: string | null;
  ownerName?: string | null;
  type: TaskType;
  title: string;
  dueAt: string;
  origin?: "manual" | "automation";
  sourceWorkflowRunId?: string | null;
  sourceWorkflowStepId?: string | null;
}

/**
 * Creates a task (manual or automation) and logs it to the timeline. This IS
 * the next-action mechanism (see migration SECTION 8) — there is no
 * separate "next action" write; callers that also want to log a
 * lead-level activity note for a stage/automation change do so themselves.
 */
export async function createTask(
  db: Queryable,
  actor: Actor | null,
  input: CreateTaskInput,
): Promise<TaskRow> {
  if (!input.title.trim()) throw new ValidationError("Task title is required.");
  const origin = input.origin ?? "manual";
  if (origin === "automation" && !input.sourceWorkflowRunId) {
    throw new ValidationError("Automation-originated tasks require sourceWorkflowRunId.");
  }

  const result = await db.query<TaskRow>(
    `insert into public.tasks
      (lead_id, owner_id, owner_name, task_type, title, due_at, origin,
       source_workflow_run_id, source_workflow_step_id, created_by, created_by_name)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     returning *`,
    [
      input.leadId,
      input.ownerId ?? null,
      input.ownerName ?? null,
      input.type,
      input.title.trim(),
      input.dueAt,
      origin,
      input.sourceWorkflowRunId ?? null,
      input.sourceWorkflowStepId ?? null,
      actor?.id ?? null,
      actor?.fullName ?? (origin === "automation" ? "Automation" : null),
    ],
  );
  const task = result.rows[0]!;

  const who = origin === "automation" ? AUTOMATION_ACTOR : actor ? actorEvent(actor) : AUTOMATION_ACTOR;
  await addTimelineEvent(db, {
    leadId: input.leadId,
    kind: "task",
    title: "Task Created",
    detail: task.title,
    actorId: who.actorId,
    actorName: who.actorName,
    actorSource: who.actorSource,
    relatedTaskId: task.id,
  });

  return task;
}

async function getTaskOr404(db: Queryable, id: string): Promise<TaskRow> {
  const result = await db.query<TaskRow>(`select * from public.tasks where id = $1`, [id]);
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Task");
  return row;
}

export interface UpdateTaskInput {
  ownerId?: string;
  type?: TaskType;
  title?: string;
  dueAt?: string;
}

export async function updateTask(db: Queryable, actor: Actor, id: string, patch: UpdateTaskInput) {
  const current = await getTaskOr404(db, id);
  if (current.status !== "open") throw new ConflictError("Only an open task can be edited.");
  if (patch.title !== undefined && !patch.title.trim()) throw new ValidationError("Task title is required.");

  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  const push = (column: string, value: unknown) => { sets.push(`${column} = $${i++}`); params.push(value); };
  if (patch.ownerId !== undefined) push("owner_id", patch.ownerId);
  if (patch.type !== undefined) push("task_type", patch.type);
  if (patch.title !== undefined) push("title", patch.title.trim());
  if (patch.dueAt !== undefined) push("due_at", patch.dueAt);
  if (sets.length === 0) return taskToDto(current);

  params.push(id);
  const result = await db.query<TaskRow>(`update public.tasks set ${sets.join(", ")} where id = $${i} returning *`, params);
  const task = result.rows[0]!;
  await addTimelineEvent(db, { leadId: task.lead_id, kind: "task", title: "Task Updated", detail: task.title, ...actorEvent(actor), relatedTaskId: task.id });
  return taskToDto(task);
}

export async function completeTask(db: Queryable, actor: Actor, id: string): Promise<TaskRow> {
  const existing = await getTaskOr404(db, id);
  if (existing.status !== "open") return existing;

  const result = await db.query<TaskRow>(
    `update public.tasks set status = 'completed', completed_at = now() where id = $1 returning *`,
    [id],
  );
  const task = result.rows[0]!;
  await addTimelineEvent(db, {
    leadId: task.lead_id,
    kind: "task",
    title: "Task Completed",
    detail: task.title,
    ...actorEvent(actor),
    relatedTaskId: task.id,
  });
  return task;
}

export async function cancelTask(
  db: Queryable,
  actor: Actor | null,
  id: string,
  reason?: string,
): Promise<TaskRow> {
  const existing = await getTaskOr404(db, id);
  if (existing.status !== "open") return existing;

  const result = await db.query<TaskRow>(
    `update public.tasks
       set status = 'cancelled', cancelled_at = now(), cancel_reason = $2
     where id = $1
     returning *`,
    [id, reason ?? null],
  );
  const task = result.rows[0]!;
  const who = actor ? actorEvent(actor) : AUTOMATION_ACTOR;
  await addTimelineEvent(db, {
    leadId: task.lead_id,
    kind: "task",
    title: "Task Cancelled",
    detail: reason ?? task.title,
    actorId: who.actorId,
    actorName: who.actorName,
    actorSource: who.actorSource,
    relatedTaskId: task.id,
  });
  return task;
}

/** Cancels every currently-open task for a lead — used on terminal lifecycle transitions. */
export async function cancelOpenTasksForLead(
  db: Queryable,
  actor: Actor | null,
  leadId: string,
  reason: string,
  taskTypeFilter?: TaskType[],
): Promise<number> {
  const filterClause = taskTypeFilter?.length ? `and task_type = any($3::public.task_type[])` : "";
  const params: unknown[] = [leadId, reason];
  if (taskTypeFilter?.length) params.push(taskTypeFilter);
  const result = await db.query<TaskRow>(
    `update public.tasks
       set status = 'cancelled', cancelled_at = now(), cancel_reason = $2
     where lead_id = $1 and status = 'open' ${filterClause}
     returning *`,
    params,
  );
  const who = actor ? actorEvent(actor) : AUTOMATION_ACTOR;
  for (const task of result.rows) {
    await addTimelineEvent(db, {
      leadId,
      kind: "task",
      title: "Task Cancelled",
      detail: `${task.title} — ${reason}`,
      actorId: who.actorId,
      actorName: who.actorName,
      actorSource: who.actorSource,
      relatedTaskId: task.id,
    });
  }
  return result.rowCount ?? 0;
}

export interface ListTasksFilters {
  ownerId?: string;
  leadId?: string;
  status?: "open" | "completed" | "cancelled";
  type?: TaskType;
  dueBefore?: string;
  overdueOnly?: boolean;
  dueTodayOnly?: boolean;
}

export async function listTasks(db: Queryable, filters: ListTasksFilters) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (filters.ownerId) {
    clauses.push(`owner_id = $${i++}`);
    params.push(filters.ownerId);
  }
  if (filters.leadId) {
    clauses.push(`lead_id = $${i++}`);
    params.push(filters.leadId);
  }
  if (filters.status) {
    clauses.push(`status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.type) {
    clauses.push(`task_type = $${i++}`);
    params.push(filters.type);
  }
  if (filters.overdueOnly) {
    clauses.push(`status = 'open' and due_at < now()`);
  }
  if (filters.dueTodayOnly) {
    clauses.push(`status = 'open'
      and due_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
      and due_at < (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day') at time zone 'Asia/Kolkata'`);
  }

  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  const result = await db.query<TaskRow>(
    `select * from public.tasks ${where} order by due_at asc`,
    params,
  );
  return result.rows.map(taskToDto);
}

export async function getLeadNextAction(db: Queryable, leadId: string) {
  const result = await db.query<{
    task_id: string;
    task_type: TaskType;
    title: string;
    due_at: Date;
    owner_id: string | null;
    owner_name: string | null;
    origin: "manual" | "automation";
  }>(`select * from public.lead_next_actions where lead_id = $1`, [leadId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    taskId: row.task_id,
    type: row.task_type,
    title: row.title,
    dueAt: row.due_at.toISOString(),
    ownerId: row.owner_id ?? undefined,
    ownerName: row.owner_name ?? undefined,
    origin: row.origin,
  };
}
