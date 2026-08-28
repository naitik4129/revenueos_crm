import type { Queryable } from "../dto.js";
import type { Actor } from "../authMiddleware.js";
import { InvalidTransitionError, NotFoundError, ValidationError } from "../errors.js";
import type { WorkflowStatus, WorkflowStepAction, WorkflowTrigger, WorkflowVersionStatus } from "../domain/enums.js";
import { findUnknownTemplateTokens } from "../domain/templateRenderer.js";

export interface WorkflowRow {
  id: string;
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
      createdBy: v.created_by_name ?? "—",
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

export async function getWorkflowRowOr404(db: Queryable, id: string): Promise<WorkflowRow> {
  const result = await db.query<WorkflowRow>(`select * from public.workflows where id = $1`, [id]);
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Workflow");
  return row;
}

export async function listWorkflows(db: Queryable) {
  const result = await db.query<WorkflowRow>(`select * from public.workflows order by updated_at desc`);
  const out = [];
  for (const row of result.rows) out.push(await workflowToDto(db, row));
  return out;
}

export async function getWorkflow(db: Queryable, id: string) {
  const row = await getWorkflowRowOr404(db, id);
  return workflowToDto(db, row);
}

/** Finds this trigger's currently-active workflows with a published version — used by runs.service for auto-enrollment. */
export async function findActiveWorkflowsForTrigger(db: Queryable, trigger: WorkflowTrigger) {
  const result = await db.query<{ workflow_id: string; version_id: string; version_number: number }>(
    `select w.id as workflow_id, wv.id as version_id, wv.version_number
       from public.workflows w
       join public.workflow_versions wv on wv.workflow_id = w.id and wv.status = 'published'
      where w.trigger = $1 and w.status = 'active'`,
    [trigger],
  );
  return result.rows;
}

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  trigger: WorkflowTrigger;
  ownerId?: string;
}

export async function createWorkflow(db: Queryable, actor: Actor, input: CreateWorkflowInput) {
  if (!input.name.trim()) throw new ValidationError("Workflow name is required.");
  const result = await db.query<{ id: string }>(
    `insert into public.workflows (name, description, trigger, status, owner_id, created_by, created_by_name)
     values ($1,$2,$3,'paused',$4,$5,$6) returning id`,
    [input.name.trim(), input.description?.trim() ?? null, input.trigger, input.ownerId ?? actor.id, actor.id, actor.fullName],
  );
  const id = result.rows[0]!.id;

  await db.query(
    `insert into public.workflow_versions (workflow_id, version_number, status, created_by, created_by_name)
     values ($1, 1, 'draft', $2, $3)`,
    [id, actor.id, actor.fullName],
  );

  return getWorkflow(db, id);
}

export async function updateWorkflow(db: Queryable, id: string, patch: { name?: string; description?: string; status?: WorkflowStatus; ownerId?: string; trigger?: WorkflowTrigger }) {
  await getWorkflowRowOr404(db, id);
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (patch.name !== undefined) {
    sets.push(`name = $${i++}`);
    params.push(patch.name.trim());
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
  return getWorkflow(db, id);
}

/** Idempotent: returns the existing draft if one exists, otherwise clones the published version's steps. */
export async function createDraft(db: Queryable, actor: Actor, workflowId: string) {
  await getWorkflowRowOr404(db, workflowId);
  const versions = await db.query<WorkflowVersionRow>(
    `select * from public.workflow_versions where workflow_id = $1 order by version_number desc`,
    [workflowId],
  );
  const existingDraft = versions.rows.find((v) => v.status === "draft");
  if (existingDraft) return getWorkflow(db, workflowId);

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

  return getWorkflow(db, workflowId);
}

export interface StepInput {
  order: number;
  delayDays: number;
  action: WorkflowStepAction;
  templateId?: string | null;
  config?: string | null;
  enabled: boolean;
}

/** Replaces the full step list of a Draft version. workflow_steps_draft_only_edit (DB trigger) is the hard backstop. */
export async function updateDraftSteps(db: Queryable, workflowId: string, version: number, steps: StepInput[]) {
  const versionRow = await db.query<WorkflowVersionRow>(
    `select * from public.workflow_versions where workflow_id = $1 and version_number = $2`,
    [workflowId, version],
  );
  const v = versionRow.rows[0];
  if (!v) throw new NotFoundError("Workflow version");
  if (v.status !== "draft") {
    throw new InvalidTransitionError(`Version ${version} is "${v.status}" — only a Draft version's steps can be edited.`);
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

  return getWorkflow(db, workflowId);
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
    throw new ValidationError(`Cannot publish — unrecognized template variable(s) found: ${problems.join("; ")}`);
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
export async function publishVersion(db: Queryable, actor: Actor, workflowId: string, version: number, enrollmentMode: EnrollmentMode = "keep_existing") {
  if (enrollmentMode !== "keep_existing") {
    throw new InvalidTransitionError(
      `Enrollment mode "${enrollmentMode}" is not implemented yet — existing runs always keep the version they were enrolled against. Use "keep_existing".`,
    );
  }

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

  return getWorkflow(db, workflowId);
}

export async function duplicateWorkflow(db: Queryable, actor: Actor, workflowId: string) {
  const source = await getWorkflowRowOr404(db, workflowId);
  const versions = await db.query<WorkflowVersionRow>(
    `select * from public.workflow_versions where workflow_id = $1 order by version_number desc`,
    [workflowId],
  );
  const base = versions.rows.find((v) => v.status === "published") ?? versions.rows[0];

  const created = await db.query<{ id: string }>(
    `insert into public.workflows (name, description, trigger, status, owner_id, created_by, created_by_name)
     values ($1,$2,$3,'paused',$4,$5,$6) returning id`,
    [`${source.name} (copy)`, source.description, source.trigger, source.owner_id, actor.id, actor.fullName],
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

  return getWorkflow(db, newId);
}

// ---------------------------------------------------------------------------
// Message templates
// ---------------------------------------------------------------------------

export interface TemplateRow {
  id: string;
  name: string;
  channel: "email" | "whatsapp";
  subject: string | null;
  body: string;
  attachment_reference: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

function templateToDto(row: TemplateRow) {
  return {
    id: row.id,
    name: row.name,
    type: row.channel,
    subject: row.subject ?? "",
    body: row.body,
    attachment: row.attachment_reference ?? undefined,
    active: row.is_active,
  };
}

export async function listTemplates(db: Queryable) {
  const result = await db.query<TemplateRow>(`select * from public.message_templates order by name asc`);
  return result.rows.map(templateToDto);
}

export async function createTemplate(db: Queryable, actor: Actor, input: { name: string; channel: "email" | "whatsapp"; subject?: string; body: string; attachment?: string }) {
  if (!input.name.trim()) throw new ValidationError("Template name is required.");
  if (!input.body.trim()) throw new ValidationError("Template body is required.");
  if (input.channel === "whatsapp" && input.subject) {
    throw new ValidationError("WhatsApp templates cannot have a subject.");
  }
  const result = await db.query<TemplateRow>(
    `insert into public.message_templates (name, channel, subject, body, attachment_reference, created_by, created_by_name)
     values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [input.name.trim(), input.channel, input.channel === "email" ? input.subject?.trim() || null : null, input.body, input.attachment ?? null, actor.id, actor.fullName],
  );
  return templateToDto(result.rows[0]!);
}

export async function updateTemplate(db: Queryable, id: string, patch: { name?: string; subject?: string; body?: string; attachment?: string; active?: boolean }) {
  const existing = await db.query<TemplateRow>(`select * from public.message_templates where id = $1`, [id]);
  if (!existing.rows[0]) throw new NotFoundError("Template");

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
  if (patch.attachment !== undefined) {
    sets.push(`attachment_reference = $${i++}`);
    params.push(patch.attachment || null);
  }
  if (patch.active !== undefined) {
    sets.push(`is_active = $${i++}`);
    params.push(patch.active);
  }
  if (sets.length) {
    params.push(id);
    await db.query(`update public.message_templates set ${sets.join(", ")} where id = $${i}`, params);
  }
  const updated = await db.query<TemplateRow>(`select * from public.message_templates where id = $1`, [id]);
  return templateToDto(updated.rows[0]!);
}
