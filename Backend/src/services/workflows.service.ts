import { randomUUID } from "node:crypto";
import type { Queryable } from "../dto.js";
import type { Actor } from "../authMiddleware.js";
import { ConflictError, InvalidTransitionError, NotFoundError, ValidationError } from "../errors.js";
import type { WorkflowStatus, WorkflowStepAction, WorkflowTrigger, WorkflowVersionStatus } from "../domain/enums.js";
import { findUnknownTemplateTokens } from "../domain/templateRenderer.js";
import { supabaseAdmin } from "../supabaseAdmin.js";

const TEMPLATE_ATTACHMENTS_BUCKET = "template-attachments";
const EMAIL_ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;
const WHATSAPP_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_SIGNED_URL_TTL_SECONDS = 300;

function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150) || "file";
}

export interface WorkflowRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  trigger: WorkflowTrigger;
  status: WorkflowStatus;
  owner_id: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface WorkflowVersionRow {
  id: string;
  workflow_id: string;
  version_number: number;
  status: WorkflowVersionStatus;
  created_by: string | null;
  created_by_name: string | null;
  created_at: Date;
  published_at: Date | null;
}

export interface WorkflowStepRow {
  id: string;
  workflow_version_id: string;
  step_order: number;
  delay_days: number;
  action: WorkflowStepAction;
  template_id: string | null;
  config: string | null;
  is_enabled: boolean;
}

function stepToDto(row: WorkflowStepRow) {
  return {
    id: row.id,
    order: row.step_order,
    delayDays: row.delay_days,
    action: row.action,
    templateId: row.template_id ?? undefined,
    config: row.config ?? undefined,
    enabled: row.is_enabled,
  };
}

async function getStepsForVersion(db: Queryable, versionId: string) {
  const result = await db.query<WorkflowStepRow>(
    `select * from public.workflow_steps where workflow_version_id = $1 order by step_order asc`,
    [versionId],
  );
  return result.rows.map(stepToDto);
}

async function getVersionsForWorkflow(db: Queryable, workflowId: string) {
  const result = await db.query<WorkflowVersionRow>(
    `select * from public.workflow_versions where workflow_id = $1 order by version_number asc`,
    [workflowId],
  );
  const versions = [];
  for (const v of result.rows) {
    versions.push({
      version: v.version_number,
      status: v.status,
      createdBy: v.created_by_name ?? "-",
      createdAt: v.created_at.toISOString(),
      publishedAt: v.published_at?.toISOString(),
      steps: await getStepsForVersion(db, v.id),
    });
  }
  return versions;
}

async function workflowToDto(db: Queryable, row: WorkflowRow) {
  const versions = await getVersionsForWorkflow(db, row.id);
  const published = versions.find((v) => v.status === "published");
  const activeLeads = await db.query<{ count: string }>(
    `select count(*)::text as count from public.workflow_runs
      where workflow_id = $1 and status in ('running','waiting','paused')`,
    [row.id],
  );
  const failures = await db.query<{ count: string }>(
    `select count(*)::text as count from public.workflow_runs where workflow_id = $1 and status = 'failed'`,
    [row.id],
  );
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    trigger: row.trigger,
    status: row.status,
    currentVersion: published?.version ?? versions.at(-1)?.version ?? 0,
    activeLeads: Number(activeLeads.rows[0]?.count ?? 0),
    failures: Number(failures.rows[0]?.count ?? 0),
    ownerId: row.owner_id ?? undefined,
    updatedAt: row.updated_at.toISOString(),
    versions,
  };
}

export async function getWorkflowRowOr404(db: Queryable, workspaceId: string, id: string): Promise<WorkflowRow> {
  const result = await db.query<WorkflowRow>(`select * from public.workflows where id = $1 and workspace_id = $2`, [id, workspaceId]);
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Workflow");
  return row;
}

export async function listWorkflows(db: Queryable, workspaceId: string) {
  const result = await db.query<WorkflowRow>(`select * from public.workflows where workspace_id = $1 order by updated_at desc`, [workspaceId]);
  const out = [];
  for (const row of result.rows) out.push(await workflowToDto(db, row));
  return out;
}

export async function getWorkflow(db: Queryable, workspaceId: string, id: string) {
  const row = await getWorkflowRowOr404(db, workspaceId, id);
  return workflowToDto(db, row);
}

/** Finds this trigger's currently-active workflows with a published version, scoped to one workspace — used by runs.service for auto-enrollment (a lead is only ever eligible for its own workspace's workflows). */
export async function findActiveWorkflowsForTrigger(db: Queryable, workspaceId: string, trigger: WorkflowTrigger) {
  const result = await db.query<{ workflow_id: string; version_id: string; version_number: number }>(
    `select w.id as workflow_id, wv.id as version_id, wv.version_number
       from public.workflows w
       join public.workflow_versions wv on wv.workflow_id = w.id and wv.status = 'published'
      where w.workspace_id = $1 and w.trigger = $2 and w.status = 'active'`,
    [workspaceId, trigger],
  );
  return result.rows;
}

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  trigger: WorkflowTrigger;
  ownerId?: string;
}

export async function createWorkflow(db: Queryable, actor: Actor, workspaceId: string, input: CreateWorkflowInput) {
  if (!input.name.trim()) throw new ValidationError("Workflow name is required.");
  const result = await db.query<{ id: string }>(
    `insert into public.workflows (workspace_id, name, description, trigger, status, owner_id, created_by, created_by_name)
     values ($1,$2,$3,$4,'paused',$5,$6,$7) returning id`,
    [workspaceId, input.name.trim(), input.description?.trim() ?? null, input.trigger, input.ownerId ?? actor.id, actor.id, actor.fullName],
  );
  const id = result.rows[0]!.id;

  await db.query(
    `insert into public.workflow_versions (workflow_id, version_number, status, created_by, created_by_name)
     values ($1, 1, 'draft', $2, $3)`,
    [id, actor.id, actor.fullName],
  );

  return getWorkflow(db, workspaceId, id);
}

export async function updateWorkflow(db: Queryable, workspaceId: string, id: string, patch: { name?: string; description?: string; status?: WorkflowStatus; ownerId?: string; trigger?: WorkflowTrigger }) {
  await getWorkflowRowOr404(db, workspaceId, id);
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new ValidationError("Workflow name is required.");
    sets.push(`name = $${i++}`);
    params.push(name);
  }
  if (patch.description !== undefined) {
    sets.push(`description = $${i++}`);
    params.push(patch.description.trim());
  }
  if (patch.status !== undefined) {
    sets.push(`status = $${i++}`);
    params.push(patch.status);
  }
  if (patch.ownerId !== undefined) {
    sets.push(`owner_id = $${i++}`);
    params.push(patch.ownerId);
  }
  if (patch.trigger !== undefined) {
    sets.push(`trigger = $${i++}`);
    params.push(patch.trigger);
  }
  if (sets.length) {
    params.push(id);
    await db.query(`update public.workflows set ${sets.join(", ")} where id = $${i}`, params);
  }
  return getWorkflow(db, workspaceId, id);
}

/** Idempotent: returns the existing draft if one exists, otherwise clones the published version's steps. */
export async function createDraft(db: Queryable, actor: Actor, workspaceId: string, workflowId: string) {
  await getWorkflowRowOr404(db, workspaceId, workflowId);
  const versions = await db.query<WorkflowVersionRow>(
    `select * from public.workflow_versions where workflow_id = $1 order by version_number desc`,
    [workflowId],
  );
  const existingDraft = versions.rows.find((v) => v.status === "draft");
  if (existingDraft) return getWorkflow(db, workspaceId, workflowId);

  const published = versions.rows.find((v) => v.status === "published");
  const nextNumber = (versions.rows[0]?.version_number ?? 0) + 1;

  const created = await db.query<{ id: string }>(
    `insert into public.workflow_versions (workflow_id, version_number, status, created_by, created_by_name)
     values ($1,$2,'draft',$3,$4) returning id`,
    [workflowId, nextNumber, actor.id, actor.fullName],
  );
  const newVersionId = created.rows[0]!.id;

  if (published) {
    const steps = await getStepsForVersion(db, published.id);
    for (const s of steps) {
      await db.query(
        `insert into public.workflow_steps (workflow_version_id, step_order, delay_days, action, template_id, config, is_enabled)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [newVersionId, s.order, s.delayDays, s.action, s.templateId ?? null, s.config ?? null, s.enabled],
      );
    }
  }

  return getWorkflow(db, workspaceId, workflowId);
}

export interface StepInput {
  order: number;
  delayDays: number;
  action: WorkflowStepAction;
  templateId?: string | null;
  config?: string | null;
  enabled: boolean;
}

/**
 * Replaces the full step list of a Draft version. workflow_steps_draft_only_edit
 * (DB trigger) is the hard backstop.
 *
 * The `for update` lock below is required, not optional: this function does a
 * delete-all-then-insert-all against `workflow_steps` inside one transaction,
 * so two overlapping calls for the *same* version (two rapid edits from one
 * tab, or two tabs/users) can otherwise interleave — the second transaction's
 * DELETE takes its snapshot before the first's INSERTs are visible, so it
 * deletes nothing, then its INSERTs collide with the first's already-committed
 * `step_order` values and raise `workflow_steps_unique_order`. Locking the
 * version row first forces a second overlapping call to wait for the first to
 * fully commit, so its delete+insert always runs against the true latest state.
 */
export async function updateDraftSteps(db: Queryable, workspaceId: string, workflowId: string, version: number, steps: StepInput[]) {
  await getWorkflowRowOr404(db, workspaceId, workflowId);
  const versionRow = await db.query<WorkflowVersionRow>(
    `select * from public.workflow_versions where workflow_id = $1 and version_number = $2 for update`,
    [workflowId, version],
  );
  const v = versionRow.rows[0];
  if (!v) throw new NotFoundError("Workflow version");
  if (v.status !== "draft") {
    throw new InvalidTransitionError(`Version ${version} is "${v.status}" - only a Draft version's steps can be edited.`);
  }

  const templateIds = [...new Set(steps.flatMap((s) => (s.templateId ? [s.templateId] : [])))];
  if (templateIds.length > 0) {
    const owned = await db.query<{ id: string }>(
      `select id from public.message_templates where id = any($1::uuid[]) and workspace_id = $2`,
      [templateIds, workspaceId],
    );
    if (owned.rows.length !== templateIds.length) {
      throw new ValidationError("One or more templates do not belong to this workspace.");
    }
  }

  await db.query(`delete from public.workflow_steps where workflow_version_id = $1`, [v.id]);
  let order = 0;
  for (const s of steps) {
    if (s.action === "send_email" || s.action === "send_whatsapp") {
      if (!s.templateId) throw new ValidationError(`Step ${order + 1} (${s.action}) requires a template.`);
    }
    await db.query(
      `insert into public.workflow_steps (workflow_version_id, step_order, delay_days, action, template_id, config, is_enabled)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [v.id, order, Math.max(0, s.delayDays), s.action, s.templateId ?? null, s.config ?? null, s.enabled],
    );
    order++;
  }

  return getWorkflow(db, workspaceId, workflowId);
}

/**
 * Discards a single Draft version (and its steps) while leaving the rest of
 * the workflow and its other versions untouched — for when a user starts
 * editing a draft and decides they don't want it, without wiping the whole
 * workflow (and its published version/enrollment history) via deleteWorkflow.
 * Refuses a non-draft target (nothing to "discard" there — that's live
 * history) and refuses the workflow's only version (nothing would be left;
 * deleteWorkflow is the correct action for that case).
 *
 * Locks every version row for this workflow up front: this gives the same
 * cross-request serialization as updateDraftSteps's lock (a racing autosave
 * for this exact version either finishes first, after which this cleanly
 * finds it already handled, or is blocked until this commits, after which it
 * 404s instead of racing) and we need the full list anyway to count versions.
 */
export async function deleteWorkflowVersion(db: Queryable, workspaceId: string, workflowId: string, version: number) {
  await getWorkflowRowOr404(db, workspaceId, workflowId);
  const versions = await db.query<WorkflowVersionRow>(
    `select * from public.workflow_versions where workflow_id = $1 order by version_number asc for update`,
    [workflowId],
  );
  const target = versions.rows.find((v) => v.version_number === version);
  if (!target) throw new NotFoundError("Workflow version");
  if (target.status !== "draft") {
    throw new InvalidTransitionError(`Version ${version} is "${target.status}" - only a Draft version can be discarded.`);
  }
  if (versions.rows.length <= 1) {
    throw new ConflictError(
      "This is the workflow's only version - delete the whole workflow instead.",
      { reason: "only_version" },
    );
  }

  await db.query(`delete from public.workflow_steps where workflow_version_id = $1`, [target.id]);
  await db.query(`delete from public.workflow_versions where id = $1`, [target.id]);
  return getWorkflow(db, workspaceId, workflowId);
}

export type EnrollmentMode = "keep_existing" | "migrate_to_new_version" | "restart_from_start";

/**
 * Refuses to publish a version whose send_email/send_whatsapp steps
 * reference a template containing a `{{...}}` token outside the known set
 * (src/domain/templateRenderer.ts's KNOWN_TEMPLATE_VARIABLES) — a typo'd
 * variable would otherwise ship straight to a real customer's inbox/WhatsApp
 * as literal `{{lead.nikname}}`-style text (src/worker.ts's renderer leaves
 * unknown tokens untouched by design, rather than guessing or blanking).
 */
async function assertNoUnknownTemplateVariables(db: Queryable, versionId: string): Promise<void> {
  const result = await db.query<{ step_order: number; template_name: string; subject: string | null; body: string }>(
    `select ws.step_order, mt.name as template_name, mt.subject, mt.body
       from public.workflow_steps ws
       join public.message_templates mt on mt.id = ws.template_id
      where ws.workflow_version_id = $1 and ws.action in ('send_email', 'send_whatsapp')`,
    [versionId],
  );

  const problems: string[] = [];
  for (const row of result.rows) {
    const tokens = new Set([...findUnknownTemplateTokens(row.body), ...(row.subject ? findUnknownTemplateTokens(row.subject) : [])]);
    if (tokens.size > 0) {
      problems.push(`Step ${row.step_order + 1} template "${row.template_name}": {{${[...tokens].join("}}, {{")}}}`);
    }
  }

  if (problems.length > 0) {
    throw new ValidationError(`Cannot publish - unrecognized template variable(s) found: ${problems.join("; ")}`);
  }
}

/**
 * Publishing never touches existing workflow_runs (Rule 11: a run keeps the
 * version it entered) — this is the "safe default" the product brief asks
 * for while the real migration UX isn't finalized. Only `keep_existing` is
 * implemented; the other two modes are accepted as a well-defined API shape
 * for a future phase, but rejected explicitly rather than silently
 * pretending to do something they don't.
 */
export async function publishVersion(db: Queryable, actor: Actor, workspaceId: string, workflowId: string, version: number, enrollmentMode: EnrollmentMode = "keep_existing") {
  if (enrollmentMode !== "keep_existing") {
    throw new InvalidTransitionError(
      `Enrollment mode "${enrollmentMode}" is not implemented yet - existing runs always keep the version they were enrolled against. Use "keep_existing".`,
    );
  }

  await getWorkflowRowOr404(db, workspaceId, workflowId);
  const versionRow = await db.query<WorkflowVersionRow>(
    `select * from public.workflow_versions where workflow_id = $1 and version_number = $2`,
    [workflowId, version],
  );
  const v = versionRow.rows[0];
  if (!v) throw new NotFoundError("Workflow version");
  if (v.status !== "draft") throw new InvalidTransitionError(`Version ${version} is already "${v.status}".`);

  const stepCount = await db.query<{ count: string }>(`select count(*)::text as count from public.workflow_steps where workflow_version_id = $1`, [v.id]);
  if (Number(stepCount.rows[0]?.count ?? 0) === 0) {
    throw new ValidationError("Cannot publish a version with no steps.");
  }

  await assertNoUnknownTemplateVariables(db, v.id);

  // Demote the currently-published version first, then promote the new one
  // — the partial unique index (one Published per workflow) is not
  // deferrable, so both statements must never coexist with two "published"
  // rows at once.
  await db.query(
    `update public.workflow_versions set status = 'previous' where workflow_id = $1 and status = 'published'`,
    [workflowId],
  );
  await db.query(
    `update public.workflow_versions set status = 'published', published_at = now() where id = $1`,
    [v.id],
  );

  return getWorkflow(db, workspaceId, workflowId);
}

export async function duplicateWorkflow(db: Queryable, actor: Actor, workspaceId: string, workflowId: string) {
  const source = await getWorkflowRowOr404(db, workspaceId, workflowId);
  const versions = await db.query<WorkflowVersionRow>(
    `select * from public.workflow_versions where workflow_id = $1 order by version_number desc`,
    [workflowId],
  );
  const base = versions.rows.find((v) => v.status === "published") ?? versions.rows[0];

  const created = await db.query<{ id: string }>(
    `insert into public.workflows (workspace_id, name, description, trigger, status, owner_id, created_by, created_by_name)
     values ($1,$2,$3,$4,'paused',$5,$6,$7) returning id`,
    [workspaceId, `${source.name} (copy)`, source.description, source.trigger, source.owner_id, actor.id, actor.fullName],
  );
  const newId = created.rows[0]!.id;

  const newVersion = await db.query<{ id: string }>(
    `insert into public.workflow_versions (workflow_id, version_number, status, created_by, created_by_name)
     values ($1, 1, 'draft', $2, $3) returning id`,
    [newId, actor.id, actor.fullName],
  );

  if (base) {
    const steps = await getStepsForVersion(db, base.id);
    for (const s of steps) {
      await db.query(
        `insert into public.workflow_steps (workflow_version_id, step_order, delay_days, action, template_id, config, is_enabled)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [newVersion.rows[0]!.id, s.order, s.delayDays, s.action, s.templateId ?? null, s.config ?? null, s.enabled],
      );
    }
  }

  return getWorkflow(db, workspaceId, newId);
}

/**
 * `workflow_runs.workflow_id`/`workflow_version_id` are ON DELETE RESTRICT
 * (Supabase/migrations/001_initial_migration.sql:1202-1203) — enrollment
 * history must survive a workflow being deleted by default, so a workflow
 * that any lead has ever been enrolled in (any run status, not just active
 * ones) is refused unless the caller explicitly passes `force: true`
 * (surfaced in the UI as a second "force delete" confirmation after the
 * first one is refused) — in which case its workflow_runs rows are deleted
 * first (scheduled_actions.workflow_run_id is ON DELETE CASCADE, so those
 * go with them; tasks/timeline_events referencing a run are ON DELETE SET
 * NULL, so those survive as orphaned records instead of being deleted).
 *
 * Versions/steps are ON DELETE CASCADE from workflows, but that cascade
 * alone is NOT enough: `workflow_steps_draft_only_edit` (a defense-in-depth
 * trigger, migration line ~1139) fires on every insert/update/delete of a
 * workflow_steps row — including ones removed by cascade — and refuses to
 * touch a step unless its parent version's status is "Draft" (by the time
 * the cascade reaches the steps, the version row is already gone, so the
 * trigger sees status NULL and rejects it: "workflow_steps can only be
 * modified while their workflow_version is Draft"). That guard exists to
 * stop a *live* Published/Previous version's historical steps from being
 * silently rewritten — but we're deleting the whole workflow, so there's no
 * history left to protect. Flip each version to Draft immediately before
 * removing it, one at a time (never two at once — the partial unique index
 * workflow_versions_one_draft_per_workflow allows only one Draft per
 * workflow), so every step delete happens while its trigger check passes.
 */
export async function deleteWorkflow(db: Queryable, workspaceId: string, id: string, options: { force?: boolean } = {}) {
  await getWorkflowRowOr404(db, workspaceId, id);
  const runs = await db.query<{ count: string }>(`select count(*)::text as count from public.workflow_runs where workflow_id = $1`, [id]);
  const runCount = Number(runs.rows[0]?.count ?? 0);
  if (runCount > 0 && !options.force) {
    throw new ConflictError(
      `${runCount} lead${runCount === 1 ? " has" : "s have"} been enrolled in this workflow - pause it instead, or force-delete to permanently remove its enrollment history too.`,
      { reason: "has_enrollment_history", runCount },
    );
  }
  if (runCount > 0) {
    await db.query(`delete from public.workflow_runs where workflow_id = $1`, [id]);
  }

  const versions = await db.query<{ id: string; status: WorkflowVersionStatus }>(
    `select id, status from public.workflow_versions where workflow_id = $1 order by (status = 'draft') desc`,
    [id],
  );
  for (const version of versions.rows) {
    if (version.status !== "draft") {
      await db.query(`update public.workflow_versions set status = 'draft', published_at = null where id = $1`, [version.id]);
    }
    await db.query(`delete from public.workflow_steps where workflow_version_id = $1`, [version.id]);
    await db.query(`delete from public.workflow_versions where id = $1`, [version.id]);
  }

  await db.query(`delete from public.workflows where id = $1`, [id]);
}

// ---------------------------------------------------------------------------
// Message templates
// ---------------------------------------------------------------------------

export interface TemplateRow {
  id: string;
  workspace_id: string;
  name: string;
  channel: "email" | "whatsapp";
  subject: string | null;
  body: string;
  is_active: boolean;
  is_default_meeting_scheduled_email: boolean;
  is_default_meeting_scheduled_whatsapp: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface TemplateAttachmentRow {
  id: string;
  template_id: string;
  file_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  created_at: Date;
}

function templateToDto(row: TemplateRow) {
  return {
    id: row.id,
    name: row.name,
    type: row.channel,
    subject: row.subject ?? "",
    body: row.body,
    active: row.is_active,
    isDefaultMeetingScheduled: row.channel === "email" ? row.is_default_meeting_scheduled_email : row.is_default_meeting_scheduled_whatsapp,
  };
}

export async function listTemplates(db: Queryable, workspaceId: string) {
  const result = await db.query<TemplateRow>(`select * from public.message_templates where workspace_id = $1 order by name asc`, [workspaceId]);
  return result.rows.map(templateToDto);
}

/** Same as listTemplates but with each template's attachments (and a short-lived signed download URL per attachment) merged in — used by the templates list route. */
export async function listTemplatesWithAttachments(db: Queryable, workspaceId: string) {
  const templates = await listTemplates(db, workspaceId);
  if (templates.length === 0) return templates.map((t) => ({ ...t, attachments: [] as ReturnType<typeof attachmentToDto>[] }));

  const attachmentsResult = await db.query<TemplateAttachmentRow>(
    `select * from public.template_attachments where template_id = any($1) order by created_at asc`,
    [templates.map((t) => t.id)],
  );
  const byTemplateId = new Map<string, TemplateAttachmentRow[]>();
  for (const row of attachmentsResult.rows) {
    const list = byTemplateId.get(row.template_id) ?? [];
    list.push(row);
    byTemplateId.set(row.template_id, list);
  }

  return Promise.all(
    templates.map(async (template) => {
      const rows = byTemplateId.get(template.id) ?? [];
      const attachments = await Promise.all(rows.map((row) => attachmentToDto(row)));
      return { ...template, attachments };
    }),
  );
}

async function getTemplateRowOr404(db: Queryable, workspaceId: string, id: string): Promise<TemplateRow> {
  const result = await db.query<TemplateRow>(`select * from public.message_templates where id = $1 and workspace_id = $2`, [id, workspaceId]);
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Template");
  return row;
}

export async function createTemplate(db: Queryable, actor: Actor, workspaceId: string, input: { name: string; channel: "email" | "whatsapp"; subject?: string; body: string }) {
  if (!input.name.trim()) throw new ValidationError("Template name is required.");
  if (!input.body.trim()) throw new ValidationError("Template body is required.");
  if (input.channel === "whatsapp" && input.subject) {
    throw new ValidationError("WhatsApp templates cannot have a subject.");
  }
  const result = await db.query<TemplateRow>(
    `insert into public.message_templates (workspace_id, name, channel, subject, body, created_by, created_by_name)
     values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [workspaceId, input.name.trim(), input.channel, input.channel === "email" ? input.subject?.trim() || null : null, input.body, actor.id, actor.fullName],
  );
  return templateToDto(result.rows[0]!);
}

export async function updateTemplate(
  db: Queryable,
  workspaceId: string,
  id: string,
  patch: { name?: string; subject?: string; body?: string; active?: boolean; isDefaultMeetingScheduled?: boolean },
) {
  const current = await getTemplateRowOr404(db, workspaceId, id);

  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (patch.name !== undefined) {
    sets.push(`name = $${i++}`);
    params.push(patch.name.trim());
  }
  if (patch.subject !== undefined) {
    sets.push(`subject = $${i++}`);
    params.push(patch.subject.trim() || null);
  }
  if (patch.body !== undefined) {
    sets.push(`body = $${i++}`);
    params.push(patch.body);
  }
  if (patch.active !== undefined) {
    sets.push(`is_active = $${i++}`);
    params.push(patch.active);
  }
  if (patch.isDefaultMeetingScheduled !== undefined) {
    // Only one template per channel (within this workspace) may hold this
    // flag — clear the previous default (if any) before setting this one,
    // matching the partial unique index in
    // 006_google_calendar_meeting_sync.sql (that index is global, not
    // workspace-scoped, so "default meeting-scheduled template" is
    // currently a single cross-workspace flag — acceptable for now since
    // only one workspace, MOTM, uses it today; a future workspace enabling
    // this feature would need that index revisited to be workspace-scoped).
    const column = current.channel === "email" ? "is_default_meeting_scheduled_email" : "is_default_meeting_scheduled_whatsapp";
    if (patch.isDefaultMeetingScheduled) {
      await db.query(`update public.message_templates set ${column} = false where ${column} = true and id != $1`, [id]);
    }
    sets.push(`${column} = $${i++}`);
    params.push(patch.isDefaultMeetingScheduled);
  }
  if (sets.length) {
    params.push(id);
    await db.query(`update public.message_templates set ${sets.join(", ")} where id = $${i}`, params);
  }
  const updated = await db.query<TemplateRow>(`select * from public.message_templates where id = $1`, [id]);
  return templateToDto(updated.rows[0]!);
}

async function attachmentToDto(row: TemplateAttachmentRow) {
  const { data } = await supabaseAdmin.storage
    .from(TEMPLATE_ATTACHMENTS_BUCKET)
    .createSignedUrl(row.storage_path, ATTACHMENT_SIGNED_URL_TTL_SECONDS);
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    downloadUrl: data?.signedUrl ?? null,
  };
}

export async function listTemplateAttachments(db: Queryable, workspaceId: string, templateId: string) {
  await getTemplateRowOr404(db, workspaceId, templateId);
  const result = await db.query<TemplateAttachmentRow>(
    `select * from public.template_attachments where template_id = $1 order by created_at asc`,
    [templateId],
  );
  return Promise.all(result.rows.map((row) => attachmentToDto(row)));
}

export async function createTemplateAttachment(
  db: Queryable,
  workspaceId: string,
  templateId: string,
  file: { buffer: Buffer; originalName: string; mimeType: string; size: number },
) {
  const template = await getTemplateRowOr404(db, workspaceId, templateId);

  if (template.channel === "whatsapp") {
    const existing = await db.query<{ count: string }>(
      `select count(*)::text as count from public.template_attachments where template_id = $1`,
      [templateId],
    );
    if (Number(existing.rows[0]?.count ?? 0) >= 1) {
      throw new ValidationError("WhatsApp templates support only one attachment - remove the existing one first.");
    }
    if (file.size > WHATSAPP_ATTACHMENT_MAX_BYTES) {
      throw new ValidationError(`WhatsApp attachments must be under ${WHATSAPP_ATTACHMENT_MAX_BYTES / (1024 * 1024)}MB.`);
    }
  } else if (file.size > EMAIL_ATTACHMENT_MAX_BYTES) {
    throw new ValidationError(`Attachments must be under ${EMAIL_ATTACHMENT_MAX_BYTES / (1024 * 1024)}MB.`);
  }

  const storagePath = `${templateId}/${randomUUID()}-${sanitizeFileName(file.originalName)}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(TEMPLATE_ATTACHMENTS_BUCKET)
    .upload(storagePath, file.buffer, { contentType: file.mimeType, upsert: false });
  if (uploadError) throw new Error(`Failed to upload attachment: ${uploadError.message}`);

  const inserted = await db.query<TemplateAttachmentRow>(
    `insert into public.template_attachments (template_id, file_name, storage_path, mime_type, size_bytes)
     values ($1,$2,$3,$4,$5) returning *`,
    [templateId, file.originalName, storagePath, file.mimeType, file.size],
  );
  return attachmentToDto(inserted.rows[0]!);
}

export async function deleteTemplateAttachment(db: Queryable, workspaceId: string, templateId: string, attachmentId: string) {
  await getTemplateRowOr404(db, workspaceId, templateId);
  const existing = await db.query<TemplateAttachmentRow>(
    `select * from public.template_attachments where id = $1 and template_id = $2`,
    [attachmentId, templateId],
  );
  const row = existing.rows[0];
  if (!row) throw new NotFoundError("Attachment");

  const { error } = await supabaseAdmin.storage.from(TEMPLATE_ATTACHMENTS_BUCKET).remove([row.storage_path]);
  if (error) throw new Error(`Failed to remove attachment from storage: ${error.message}`);

  await db.query(`delete from public.template_attachments where id = $1`, [attachmentId]);
}

/**
 * `workflow_steps.template_id` is ON DELETE SET NULL, so deleting a template
 * never fails outright — but a step in a *published* version that loses its
 * template would silently stop sending the next time it's due
 * (computeEligibility in automation.service.ts reports "No template
 * resolved" rather than crashing, which is easy to miss). Deleting a
 * template only referenced by draft steps is fine (that's normal workflow-
 * builder editing) and still allowed.
 */
export async function deleteTemplate(db: Queryable, workspaceId: string, id: string) {
  await getTemplateRowOr404(db, workspaceId, id);

  const liveUsage = await db.query<{ count: string }>(
    `select count(*)::text as count
       from public.workflow_steps ws
       join public.workflow_versions wv on wv.id = ws.workflow_version_id
      where ws.template_id = $1 and wv.status = 'published'`,
    [id],
  );
  if (Number(liveUsage.rows[0]?.count ?? 0) > 0) {
    throw new ConflictError("Cannot delete a template used by a published workflow step - remove it from that step first.");
  }

  await db.query(`delete from public.message_templates where id = $1`, [id]);
}
