import { subjectNamesJoin, subjectNamesToDto, type Queryable, type SubjectNames } from "../dto.js";
import type { Actor } from "../authMiddleware.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors.js";
import type { TaskType } from "../domain/enums.js";
import { userNameSql } from "./profiles.service.js";
import { addTimelineEvent, actorEvent, AUTOMATION_ACTOR, toEventActor, type EventActor } from "./timeline.service.js";

export interface TaskRow extends SubjectNames {
  id: string;
  workspace_id: string;
  deal_id: string | null;
  contact_id: string | null;
  owner_id: string | null;
  owner_name: string | null;
  task_type: TaskType;
  title: string;
  due_at: Date;
  status: "open" | "completed" | "cancelled";
  origin: "manual" | "automation";
  created_by: string | null;
  source_workflow_run_id: string | null;
  source_workflow_step_id: string | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

const TASK_SELECT = `select t.*, ${userNameSql("t.owner_id")} as owner_name, names.* from crm_tasks t ${subjectNamesJoin("t.deal_id", "t.contact_id")}`;

export function taskToDto(row: TaskRow) {
  return {
    id: row.id,
    dealId: row.deal_id ?? undefined,
    contactId: row.contact_id ?? undefined,
    ...subjectNamesToDto(row),
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
  /** A deal task (its contact is taken from the deal) ... */
  dealId?: string | null;
  /** ... or a contact-only task (e.g. a prospect's callback). */
  contactId?: string | null;
  ownerId?: string | null;
  type: TaskType;
  title: string;
  dueAt: string;
  origin?: "manual" | "automation";
  sourceWorkflowRunId?: string | null;
  sourceWorkflowStepId?: string | null;
}

/**
 * Creates a task and logs it on the timeline. Tasks are the next-action mechanism. The deal or
 * contact is checked against workspaceId here, so a task always lives in its parent's workspace.
 */
export async function createTask(db: Queryable, actor: Actor | EventActor | null, workspaceId: string, input: CreateTaskInput): Promise<TaskRow> {
  if (!input.title.trim()) throw new ValidationError("Task title is required.");
  const origin = input.origin ?? "manual";
  if (origin === "automation" && !input.sourceWorkflowRunId) {
    throw new ValidationError("Automation-originated tasks require sourceWorkflowRunId.");
  }

  let contactId = input.contactId ?? null;
  if (input.dealId) {
    const deal = await db.query<{ contact_id: string }>(`select contact_id from crm_deals where id = $1 and workspace_id = $2`, [input.dealId, workspaceId]);
    if (!deal.rows[0]) throw new NotFoundError("Deal");
    contactId = deal.rows[0].contact_id;
  } else if (contactId) {
    const contact = await db.query(`select 1 from crm_contacts where id = $1 and workspace_id = $2`, [contactId, workspaceId]);
    if (!contact.rows[0]) throw new NotFoundError("Contact");
  } else {
    throw new ValidationError("A task needs a deal or a contact.");
  }

  const user = actor && "fullName" in actor ? actor : null;
  const id = (
    await db.query<{ id: string }>(
      `insert into crm_tasks
        (workspace_id, deal_id, contact_id, owner_id, task_type, title, due_at, origin,
         source_workflow_run_id, source_workflow_step_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [
        workspaceId,
        input.dealId ?? null,
        contactId,
        input.ownerId ?? null,
        input.type,
        input.title.trim(),
        input.dueAt,
        origin,
        input.sourceWorkflowRunId ?? null,
        input.sourceWorkflowStepId ?? null,
        user?.id ?? null,
      ],
    )
  ).rows[0]!.id;

  await addTimelineEvent(db, {
    dealId: input.dealId ?? null,
    contactId,
    kind: "task",
    title: "Task Created",
    detail: input.title.trim(),
    ...(origin === "automation" ? AUTOMATION_ACTOR : toEventActor(actor)),
    relatedTaskId: id,
  });
  return getTaskOr404(db, workspaceId, id);
}

export async function getTaskOr404(db: Queryable, workspaceId: string, id: string): Promise<TaskRow> {
  const result = await db.query<TaskRow>(`${TASK_SELECT} where t.id = $1 and t.workspace_id = $2`, [id, workspaceId]);
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Task");
  return row;
}

const subject = (t: TaskRow) => ({ dealId: t.deal_id, contactId: t.contact_id });

export interface UpdateTaskInput {
  ownerId?: string | null;
  type?: TaskType;
  title?: string;
  dueAt?: string;
}

export async function updateTask(db: Queryable, actor: Actor, workspaceId: string, id: string, patch: UpdateTaskInput) {
  const current = await getTaskOr404(db, workspaceId, id);
  if (current.status !== "open") throw new ConflictError("Only an open task can be edited.");
  if (patch.title !== undefined && !patch.title.trim()) throw new ValidationError("Task title is required.");

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, value: unknown) => sets.push(`${col} = $${params.push(value)}`);
  if (patch.ownerId !== undefined) set("owner_id", patch.ownerId);
  if (patch.type !== undefined) set("task_type", patch.type);
  if (patch.title !== undefined) set("title", patch.title.trim());
  if (patch.dueAt !== undefined) set("due_at", patch.dueAt);
  if (sets.length === 0) return current;

  await db.query(`update crm_tasks set ${sets.join(", ")} where id = $${params.push(id)}`, params);
  const task = await getTaskOr404(db, workspaceId, id);
  await addTimelineEvent(db, { ...subject(task), kind: "task", title: "Task Updated", detail: task.title, ...actorEvent(actor), relatedTaskId: id });
  return task;
}

export async function completeTask(db: Queryable, actor: Actor, workspaceId: string, id: string): Promise<TaskRow> {
  const existing = await getTaskOr404(db, workspaceId, id);
  if (existing.status !== "open") return existing;
  await db.query(`update crm_tasks set status = 'completed', completed_at = now() where id = $1`, [id]);
  await addTimelineEvent(db, { ...subject(existing), kind: "task", title: "Task Completed", detail: existing.title, ...actorEvent(actor), relatedTaskId: id });
  return getTaskOr404(db, workspaceId, id);
}

export async function cancelTask(db: Queryable, actor: Actor | null, workspaceId: string, id: string, reason?: string): Promise<TaskRow> {
  const existing = await getTaskOr404(db, workspaceId, id);
  if (existing.status !== "open") return existing;
  await db.query(`update crm_tasks set status = 'cancelled', cancelled_at = now(), cancel_reason = $2 where id = $1`, [id, reason ?? null]);
  await addTimelineEvent(db, { ...subject(existing), kind: "task", title: "Task Cancelled", detail: reason ?? existing.title, ...toEventActor(actor), relatedTaskId: id });
  return getTaskOr404(db, workspaceId, id);
}

/**
 * Cancels a deal's open tasks (optionally only some types). Callers have already checked the
 * deal's workspace.
 */
export async function cancelOpenTasksForDeal(db: Queryable, actor: Actor | null, dealId: string, reason: string, types?: TaskType[]): Promise<number> {
  const params: unknown[] = [dealId, reason];
  const typeFilter = types?.length ? `and task_type = any($${params.push(types)}::crm_task_type[])` : "";
  const result = await db.query<{ id: string; title: string }>(
    `update crm_tasks set status = 'cancelled', cancelled_at = now(), cancel_reason = $2
      where deal_id = $1 and status = 'open' ${typeFilter}
      returning id, title`,
    params,
  );
  for (const task of result.rows) {
    await addTimelineEvent(db, { dealId, kind: "task", title: "Task Cancelled", detail: `${task.title} - ${reason}`, ...toEventActor(actor), relatedTaskId: task.id });
  }
  return result.rowCount ?? 0;
}

export interface ListTasksFilters {
  ownerId?: string;
  dealId?: string;
  contactId?: string;
  /** Tasks on the company's deals or on its contacts. */
  companyId?: string;
  status?: "open" | "completed" | "cancelled";
  type?: TaskType;
  overdueOnly?: boolean;
  dueTodayOnly?: boolean;
  /** Open and due from tomorrow on: the complement of overdue + due today. */
  upcomingOnly?: boolean;
  limit?: number;
  offset?: number;
}

/** A contact's list includes its deals' tasks (tasks carry the contact). */
export async function listTasks(db: Queryable, workspaceId: string, f: ListTasksFilters) {
  const params: unknown[] = [workspaceId];
  const where = [`t.workspace_id = $1`];
  if (f.ownerId) where.push(`t.owner_id = $${params.push(f.ownerId)}`);
  if (f.dealId) where.push(`t.deal_id = $${params.push(f.dealId)}`);
  if (f.contactId) where.push(`t.contact_id = $${params.push(f.contactId)}`);
  if (f.companyId) {
    const p = `$${params.push(f.companyId)}`;
    where.push(`(t.deal_id in (select id from crm_deals where company_id = ${p}) or t.contact_id in (select id from crm_contacts where company_id = ${p}))`);
  }
  if (f.status) where.push(`t.status = $${params.push(f.status)}`);
  if (f.type) where.push(`t.task_type = $${params.push(f.type)}`);
  // Overdue = due before today (Asia/Kolkata), same as the dashboard; never overlaps dueTodayOnly.
  if (f.overdueOnly) where.push(`t.status = 'open' and t.due_at < date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'`);
  if (f.dueTodayOnly) {
    where.push(`t.status = 'open'
      and t.due_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
      and t.due_at < (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day') at time zone 'Asia/Kolkata'`);
  }
  if (f.upcomingOnly) {
    where.push(`t.status = 'open' and t.due_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day') at time zone 'Asia/Kolkata'`);
  }
  const limit = Math.min(f.limit ?? 200, 1000);
  const offset = f.offset ?? 0;
  const result = await db.query<TaskRow & { total: number }>(
    `select t.*, ${userNameSql("t.owner_id")} as owner_name, names.*, count(*) over()::int as total
       from crm_tasks t ${subjectNamesJoin("t.deal_id", "t.contact_id")}
      where ${where.join(" and ")}
      order by t.due_at asc
      limit $${params.push(limit)} offset $${params.push(offset)}`,
    params,
  );
  return { data: result.rows.map(taskToDto), total: result.rows[0]?.total ?? 0, limit, offset };
}
