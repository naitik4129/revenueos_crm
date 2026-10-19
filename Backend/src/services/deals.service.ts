import type { Actor } from "../authMiddleware.js";
import type { Queryable } from "../dto.js";
import { ConflictError, InvalidTransitionError, isUniqueViolation, NotFoundError } from "../errors.js";
import type {
  AutomationMode,
  ContactStatus,
  DealOutcome,
  LeadLossReason,
  LifecycleStage,
  ObjectionType,
  PipelineStage,
  ResponseState,
  TaskOrigin,
  TaskType,
} from "../domain/enums.js";
import type { TemplateRenderContext } from "../domain/templateRenderer.js";
import { assertPipelineStageEditable, assertValidPipelineStage, canRunAutomation } from "../domain/pipeline.js";
import { userNameSql } from "./profiles.service.js";
import { actorEvent, addTimelineEvent, toEventActor, type EventActor } from "./timeline.service.js";
import { writeDeletedAudit } from "./companies.service.js";
import { advanceLifecycle } from "./contacts.service.js";
import { createTask } from "./tasks.service.js";
import { applyAutomationModeToRuns, autoEnroll } from "./runs.service.js";

/** A deal with the contact/company fields every deal screen and sender needs. */
export interface DealRow {
  id: string;
  workspace_id: string;
  contact_id: string;
  company_id: string | null;
  owner_id: string | null;
  owner_name: string | null;
  service_interest: string | null;
  stage: PipelineStage;
  outcome: DealOutcome;
  automation_mode: AutomationMode;
  response_state: ResponseState;
  objection_type: ObjectionType | null;
  interested_later_reason: string | null;
  interested_later_restart_at: string | null;
  interested_later_next_action: string | null;
  interested_later_decision_owner: string | null;
  loss_reason: LeadLossReason | null;
  loss_notes: string | null;
  last_activity_at: Date;
  closed_at: Date | null;
  /** numeric comes back from pg as a string. */
  amount: string | null;
  currency: string;
  created_at: Date;
  updated_at: Date;
  // contact
  first_name: string;
  last_name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  phone_e164: string | null;
  contact_status: ContactStatus;
  lifecycle_stage: LifecycleStage;
  // company
  company_name: string | null;
  industry: string | null;
  website: string | null;
  // next action (earliest open task on the deal)
  next_task_id: string | null;
  next_task_type: TaskType | null;
  next_task_title: string | null;
  next_task_due_at: Date | null;
  next_task_owner_id: string | null;
  next_task_origin: TaskOrigin | null;
}

/** Replaces the old lead_next_actions view: one lateral lookup of the earliest open task. */
const DEAL_SELECT = `
  select d.*, ${userNameSql("d.owner_id")} as owner_name,
         c.first_name, c.last_name, c.job_title, c.email, c.phone, c.phone_e164, c.status as contact_status, c.lifecycle_stage,
         co.name as company_name, co.industry, co.website,
         na.id as next_task_id, na.task_type as next_task_type, na.title as next_task_title,
         na.due_at as next_task_due_at, na.owner_id as next_task_owner_id, na.origin as next_task_origin
    from crm.deals d
    join crm.contacts c on c.id = d.contact_id
    left join crm.companies co on co.id = d.company_id
    left join lateral (
      select t.id, t.task_type, t.title, t.due_at, t.owner_id, t.origin
        from crm.tasks t
       where t.deal_id = d.id and t.status = 'open'
       order by t.due_at
       limit 1
    ) na on true`;

export function dealToDto(row: DealRow) {
  return {
    id: row.id,
    contactId: row.contact_id,
    contactName: `${row.first_name} ${row.last_name}`.trim(),
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    contactStatus: row.contact_status,
    doNotContact: row.contact_status === "do_not_contact",
    lifecycleStage: row.lifecycle_stage,
    companyId: row.company_id ?? undefined,
    companyName: row.company_name ?? undefined,
    ownerId: row.owner_id ?? undefined,
    ownerName: row.owner_name ?? undefined,
    serviceInterest: row.service_interest ?? undefined,
    stage: row.stage,
    outcome: row.outcome,
    automationMode: row.automation_mode,
    responseState: row.response_state,
    objectionType: row.objection_type ?? undefined,
    interestedLaterReason: row.interested_later_reason ?? undefined,
    interestedLaterRestartAt: row.interested_later_restart_at ?? undefined,
    interestedLaterNextAction: row.interested_later_next_action ?? undefined,
    interestedLaterDecisionOwner: row.interested_later_decision_owner ?? undefined,
    lossReason: row.loss_reason ?? undefined,
    lossNotes: row.loss_notes ?? undefined,
    nextAction: row.next_task_id
      ? {
          taskId: row.next_task_id,
          type: row.next_task_type!,
          title: row.next_task_title!,
          dueAt: row.next_task_due_at!.toISOString(),
          ownerId: row.next_task_owner_id ?? undefined,
          origin: row.next_task_origin!,
        }
      : null,
    lastActivityAt: row.last_activity_at.toISOString(),
    closedAt: row.closed_at?.toISOString() ?? null,
    amount: row.amount === null ? null : Number(row.amount),
    currency: row.currency,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** {{contact.*}} / {{company.*}} / {{deal.*}} values for a deal's messages. */
export function dealRenderContext(row: DealRow): TemplateRenderContext {
  return {
    contact: { firstName: row.first_name, lastName: row.last_name, email: row.email, phone: row.phone, jobTitle: row.job_title },
    company: { name: row.company_name, industry: row.industry, website: row.website },
    deal: { stage: row.stage, serviceInterest: row.service_interest, ownerName: row.owner_name },
  };
}

export async function getDealOr404(db: Queryable, workspaceId: string, id: string): Promise<DealRow> {
  const result = await db.query<DealRow>(`${DEAL_SELECT} where d.id = $1 and d.workspace_id = $2`, [id, workspaceId]);
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Deal");
  return row;
}

const eventActor = toEventActor;

function openDealConflict(err: unknown): never {
  if (isUniqueViolation(err, "deals_one_open_per_contact")) {
    throw new ConflictError("This contact already has an open deal.", { reason: "open_deal_exists" });
  }
  throw err;
}

// --- Create / list / update / delete ------------------------------------------------------

export interface CreateDealInput {
  contactId: string;
  ownerId?: string | null;
  stage?: PipelineStage;
  serviceInterest?: string;
  /** Default true. logCall passes false: the call it is logging is the first call. */
  firstCallTask?: boolean;
}

/**
 * One open deal per contact (409 otherwise). Creating a deal makes the contact `qualified`.
 * actor: a user, the brain (BRAIN_ACTOR) or null (automation).
 */
export async function createDeal(db: Queryable, actor: Actor | EventActor | null, workspaceId: string, input: CreateDealInput): Promise<DealRow> {
  const user = actor && "fullName" in actor ? actor : null;
  const contact = await db.query<{ status: ContactStatus; company_id: string | null; owner_id: string | null }>(
    `select status, company_id, owner_id from crm.contacts where id = $1 and workspace_id = $2`,
    [input.contactId, workspaceId],
  );
  const c = contact.rows[0];
  if (!c) throw new NotFoundError("Contact");
  if (c.status === "merged") throw new ConflictError("This contact was merged into another contact.");
  if (input.stage) assertValidPipelineStage(input.stage);
  // Name the open deal so the UI can link to it (the unique index still guards races).
  const open = await db.query<{ id: string }>(`select id from crm.deals where contact_id = $1 and outcome = 'open'`, [input.contactId]);
  if (open.rows[0]) {
    throw new ConflictError("This contact already has an open deal.", { reason: "open_deal_exists", dealId: open.rows[0].id });
  }

  const ownerId = input.ownerId !== undefined ? input.ownerId : c.owner_id ?? (user?.role === "salesperson" ? user.id : null);
  const id = await db
    .query<{ id: string }>(
      `insert into crm.deals (workspace_id, contact_id, company_id, owner_id, stage, service_interest, created_by)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [workspaceId, input.contactId, c.company_id, ownerId, input.stage ?? "new", input.serviceInterest?.trim() || null, user?.id ?? null],
    )
    .then((r) => r.rows[0]!.id, openDealConflict);

  await addTimelineEvent(db, { dealId: id, kind: "system", title: "Deal Created", ...eventActor(actor) });
  await advanceLifecycle(db, input.contactId, "qualified", actor);
  // Every new deal starts with a next action and the deal_created workflow (if one is published).
  // Contacts alone (prospects) never enroll: enrollment needs a deal.
  if (input.firstCallTask !== false) {
    await createTask(db, actor, workspaceId, { dealId: id, ownerId, type: "call", title: "First call", dueAt: new Date().toISOString() });
  }
  await autoEnroll(db, workspaceId, id, "deal_created", "New deal");
  return getDealOr404(db, workspaceId, id);
}

export interface ListDealsFilters {
  outcome?: DealOutcome;
  stage?: PipelineStage;
  ownerId?: string;
  automationMode?: AutomationMode;
  contactId?: string;
  companyId?: string;
  missingNextAction?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listDeals(db: Queryable, workspaceId: string, f: ListDealsFilters) {
  const params: unknown[] = [workspaceId];
  const where = [`d.workspace_id = $1`];
  if (f.outcome) where.push(`d.outcome = $${params.push(f.outcome)}`);
  if (f.stage) where.push(`d.stage = $${params.push(f.stage)}`);
  if (f.ownerId) where.push(`d.owner_id = $${params.push(f.ownerId)}`);
  if (f.automationMode) where.push(`d.automation_mode = $${params.push(f.automationMode)}`);
  if (f.contactId) where.push(`d.contact_id = $${params.push(f.contactId)}`);
  if (f.companyId) where.push(`d.company_id = $${params.push(f.companyId)}`);
  if (f.missingNextAction) where.push(`d.outcome = 'open' and na.id is null`);
  if (f.search) {
    const p = `$${params.push(`%${f.search}%`)}`;
    // Full name too, so "Ann Lee" finds Ann Lee's deals.
    where.push(`(concat_ws(' ', c.first_name, c.last_name) ilike ${p} or c.email ilike ${p} or co.name ilike ${p})`);
  }
  const limit = Math.min(f.limit ?? 50, 500);
  const offset = f.offset ?? 0;
  const result = await db.query<DealRow & { total: number }>(
    `${DEAL_SELECT.replace("select d.*,", "select d.*, count(*) over()::int as total,")}
      where ${where.join(" and ")}
      order by d.last_activity_at desc
      limit $${params.push(limit)} offset $${params.push(offset)}`,
    params,
  );
  return { data: result.rows.map(dealToDto), total: result.rows[0]?.total ?? 0, limit, offset };
}

export interface UpdateDealInput {
  ownerId?: string | null;
  stage?: PipelineStage;
  responseState?: ResponseState;
  serviceInterest?: string;
  /** INR; null clears it. */
  amount?: number | null;
  /** Set alongside stage = 'objection_nurture' (or wrong_fit, reporting only). */
  objectionType?: ObjectionType;
  interestedLaterReason?: string;
  interestedLaterRestartAt?: string;
  interestedLaterNextAction?: string;
  interestedLaterDecisionOwner?: string;
}

/**
 * Field editor. Outcome, automation and deletion go through their own functions because they
 * carry side effects (run cancellation, task cleanup, lifecycle) a bare patch must not skip.
 */
export async function updateDeal(db: Queryable, actor: Actor | null, workspaceId: string, id: string, patch: UpdateDealInput): Promise<DealRow> {
  const current = await getDealOr404(db, workspaceId, id);
  if (patch.stage) {
    assertValidPipelineStage(patch.stage);
    assertPipelineStageEditable(current.outcome);
    // deals_objection_stage_has_type: the objection type comes from call routing.
    if (patch.stage === "objection_nurture" && !(patch.objectionType ?? current.objection_type)) {
      throw new InvalidTransitionError("Objection Nurture needs an objection type. Log a call with the objection outcome instead.");
    }
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, value: unknown) => sets.push(`${col} = $${params.push(value)}`);
  if (patch.ownerId !== undefined) set("owner_id", patch.ownerId);
  if (patch.stage !== undefined) set("stage", patch.stage);
  if (patch.responseState !== undefined) set("response_state", patch.responseState);
  if (patch.serviceInterest !== undefined) set("service_interest", patch.serviceInterest.trim() || null);
  if (patch.objectionType !== undefined) set("objection_type", patch.objectionType);
  if (patch.interestedLaterReason !== undefined) set("interested_later_reason", patch.interestedLaterReason.trim() || null);
  if (patch.interestedLaterRestartAt !== undefined) set("interested_later_restart_at", patch.interestedLaterRestartAt || null);
  if (patch.interestedLaterNextAction !== undefined) set("interested_later_next_action", patch.interestedLaterNextAction.trim() || null);
  if (patch.interestedLaterDecisionOwner !== undefined) set("interested_later_decision_owner", patch.interestedLaterDecisionOwner.trim() || null);
  if (patch.amount !== undefined) set("amount", patch.amount);
  if (sets.length === 0) return current;

  // Setting the amount is bookkeeping, not activity with the contact.
  const activity = Object.entries(patch).some(([key, value]) => value !== undefined && key !== "amount");
  await db.query(
    `update crm.deals set ${sets.join(", ")}${activity ? ", last_activity_at = now()" : ""} where id = $${params.push(id)}`,
    params,
  );

  if (patch.stage && patch.stage !== current.stage) {
    await addTimelineEvent(db, { dealId: id, kind: "stage", title: `Stage changed to ${patch.stage}`, ...eventActor(actor) });
  }
  if (patch.ownerId !== undefined && patch.ownerId !== current.owner_id) {
    const owner = await db.query<{ name: string | null }>(`select ${userNameSql("$1::uuid")} as name`, [patch.ownerId]);
    await addTimelineEvent(db, { dealId: id, kind: "system", title: "Deal Assigned", detail: `Owner: ${owner.rows[0]?.name ?? "Unassigned"}`, ...eventActor(actor) });
  }
  return getDealOr404(db, workspaceId, id);
}

/** Permanent delete with an audit snapshot; meetings, proposals, tasks and runs go with it. */
export async function deleteDeal(db: Queryable, actor: Actor, workspaceId: string, id: string) {
  const deal = await getDealOr404(db, workspaceId, id);
  await writeDeletedAudit(db, actor, workspaceId, "deal", id, dealToDto(deal));
  await db.query(`delete from crm.deals where id = $1`, [id]);
}

// --- Automation ---------------------------------------------------------------------------

/**
 * Deal automation switch, cascaded to the deal's in-flight runs (paused / resumed / cancelled).
 * Only open/nurture deals of an active contact can change it (the 009 guard would force
 * 'stopped' anyway).
 */
export async function setAutomationMode(db: Queryable, actor: Actor, workspaceId: string, id: string, mode: AutomationMode, reason?: string) {
  const current = await getDealOr404(db, workspaceId, id);
  if (!canRunAutomation(current.outcome, current.contact_status)) {
    throw new ConflictError(`Cannot change automation: the deal is "${current.outcome}" and the contact is "${current.contact_status}" (automation stays stopped).`);
  }
  await db.query(`update crm.deals set automation_mode = $2, last_activity_at = now() where id = $1`, [id, mode]);
  const title = mode === "active" ? "Automation Resumed" : mode === "paused" ? "Automation Paused" : mode === "stopped" ? "Automation Stopped" : "Switched to Manual";
  await addTimelineEvent(db, { dealId: id, kind: "automation", title, detail: reason, ...actorEvent(actor) });
  await applyAutomationModeToRuns(db, id, mode, reason ?? `Deal automation set to ${mode}`);
  return getDealOr404(db, workspaceId, id);
}

// --- Outcome --------------------------------------------------------------------------------
// The 009 triggers cancel in-flight runs/actions on any outcome change, cancel open tasks on
// won/lost/discarded, and force automation 'stopped' when not open/nurture.

async function setOutcome(
  db: Queryable,
  actor: Actor | null,
  workspaceId: string,
  id: string,
  outcome: Exclude<DealOutcome, "open">,
  title: string,
  detail?: string,
  extra: { loss_reason?: LeadLossReason; loss_notes?: string | null } = {},
) {
  const current = await getDealOr404(db, workspaceId, id);
  if (current.outcome === outcome) return current;
  await db.query(
    `update crm.deals
        set outcome = $2, loss_reason = coalesce($3, loss_reason), loss_notes = coalesce($4, loss_notes), last_activity_at = now()
      where id = $1`,
    [id, outcome, extra.loss_reason ?? null, extra.loss_notes ?? null],
  );
  await addTimelineEvent(db, { dealId: id, kind: "system", title, detail: detail ?? null, ...eventActor(actor) });
  if (outcome === "won") await advanceLifecycle(db, current.contact_id, "customer", actor);
  return getDealOr404(db, workspaceId, id);
}

export const markWon = (db: Queryable, actor: Actor | null, workspaceId: string, id: string, reason?: string) =>
  setOutcome(db, actor, workspaceId, id, "won", "Won", reason);

/** A loss reason is required (also enforced by deals_lost_has_reason). */
export const markLost = (db: Queryable, actor: Actor, workspaceId: string, id: string, lossReason: LeadLossReason, notes?: string) =>
  setOutcome(db, actor, workspaceId, id, "lost", "Lost", notes ?? lossReason, { loss_reason: lossReason, loss_notes: notes?.trim() || null });

export const markDiscarded = (db: Queryable, actor: Actor, workspaceId: string, id: string, reason?: string) =>
  setOutcome(db, actor, workspaceId, id, "discarded", "Discarded", reason);

/** Parks the deal (not open, not closed). A nurture workflow may then be enrolled. */
export const moveToNurture = (db: Queryable, actor: Actor | null, workspaceId: string, id: string, reason?: string) =>
  setOutcome(db, actor, workspaceId, id, "nurture", "Moved to Nurture", reason);

/** Back to open with automation 'manual'. 409 if the contact already has another open deal. */
export async function reopenDeal(db: Queryable, actor: Actor, workspaceId: string, id: string, reason?: string) {
  const current = await getDealOr404(db, workspaceId, id);
  if (current.outcome === "open") return current;
  if (current.contact_status === "merged") throw new ConflictError("This deal's contact was merged into another contact.");
  await db
    .query(`update crm.deals set outcome = 'open', automation_mode = 'manual', last_activity_at = now() where id = $1`, [id])
    .catch(openDealConflict);
  await addTimelineEvent(db, { dealId: id, kind: "system", title: "Reopened", detail: reason ?? null, ...actorEvent(actor) });
  return getDealOr404(db, workspaceId, id);
}
