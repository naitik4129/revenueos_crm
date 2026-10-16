import type { Actor } from "../authMiddleware.js";
import { pool, withTransaction } from "../db.js";
import type { Queryable } from "../dto.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors.js";
import { recordAdminAudit } from "./admin-audit.service.js";
import { PROFILE_COLUMNS, PROFILE_JOIN, profileToDto, type ProfileRow } from "./profiles.service.js";

export interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  platform_project_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export function workspaceToDto(row: WorkspaceRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    isActive: row.is_active,
    platformProjectId: row.platform_project_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "workspace";
}

/** Admins see every workspace (including inactive); salespeople only active ones they belong to. */
export async function listWorkspaces(actor: Actor, db: Queryable = pool) {
  const result =
    actor.role === "admin"
      ? await db.query<WorkspaceRow>(`select * from crm.workspaces order by created_at asc`)
      : await db.query<WorkspaceRow>(
          `select w.* from crm.workspaces w
             join crm.workspace_members m on m.workspace_id = w.id and m.user_id = $1
            where w.is_active = true
            order by w.created_at asc`,
          [actor.id],
        );
  return result.rows.map(workspaceToDto);
}

async function uniqueSlug(db: Queryable, name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;
  for (;;) {
    const existing = await db.query<{ id: string }>(`select id from crm.workspaces where slug = $1`, [candidate]);
    if (!existing.rows[0]) return candidate;
    candidate = `${base}-${suffix++}`;
  }
}

async function assertNameFree(db: Queryable, name: string, exceptId: string | null) {
  const existing = await db.query<{ id: string }>(
    `select id from crm.workspaces where lower(name) = lower($1) and id is distinct from $2`,
    [name, exceptId],
  );
  if (existing.rows[0]) throw new ConflictError(`A workspace named "${name}" already exists.`, { field: "name" });
}

/** platform_project_id has no FK (other schema), so its existence and uniqueness are checked here. */
async function assertPlatformProject(db: Queryable, projectId: string, exceptId: string | null) {
  const project = await db.query(`select 1 from public.revenueos_projects where id = $1`, [projectId]);
  if (!project.rows[0]) throw new ValidationError("Platform project not found.", { field: "platformProjectId" });
  const linked = await db.query<{ name: string }>(
    `select name from crm.workspaces where platform_project_id = $1 and id is distinct from $2`,
    [projectId, exceptId],
  );
  if (linked.rows[0]) {
    throw new ConflictError(`That platform project is already linked to "${linked.rows[0].name}".`, { field: "platformProjectId" });
  }
}

export async function createWorkspace(actor: Actor, input: { name: string; platformProjectId?: string | null }) {
  const name = input.name.trim();
  if (!name) throw new ValidationError("Workspace name is required.", { field: "name" });

  return withTransaction(async (db) => {
    await assertNameFree(db, name, null);
    if (input.platformProjectId) await assertPlatformProject(db, input.platformProjectId, null);

    const slug = await uniqueSlug(db, name);
    const result = await db.query<WorkspaceRow>(
      `insert into crm.workspaces (name, slug, platform_project_id, created_by) values ($1, $2, $3, $4) returning *`,
      [name, slug, input.platformProjectId ?? null, actor.id],
    );
    const workspace = result.rows[0]!;
    await recordAdminAudit(db, actor, "workspace.created", "workspace", workspace.id, {
      name,
      platformProjectId: workspace.platform_project_id,
    });
    return workspaceToDto(workspace);
  });
}

export interface UpdateWorkspaceInput {
  name?: string;
  isActive?: boolean;
  platformProjectId?: string | null;
}

export async function updateWorkspace(actor: Actor, id: string, input: UpdateWorkspaceInput) {
  const name = input.name?.trim();
  if (input.name !== undefined && !name) throw new ValidationError("Workspace name is required.", { field: "name" });

  return withTransaction(async (db) => {
    const current = await db.query<WorkspaceRow>(`select * from crm.workspaces where id = $1 for update`, [id]);
    if (!current.rows[0]) throw new NotFoundError("Workspace");

    if (name) await assertNameFree(db, name, id);
    if (input.platformProjectId) await assertPlatformProject(db, input.platformProjectId, id);

    const result = await db.query<WorkspaceRow>(
      `update crm.workspaces
          set name = coalesce($2, name),
              is_active = coalesce($3, is_active),
              platform_project_id = case when $4 then $5::uuid else platform_project_id end
        where id = $1
        returning *`,
      [id, name ?? null, input.isActive ?? null, input.platformProjectId !== undefined, input.platformProjectId ?? null],
    );
    await recordAdminAudit(db, actor, "workspace.updated", "workspace", id, { ...input });
    return workspaceToDto(result.rows[0]!);
  });
}

export async function listMembers(workspaceId: string) {
  const ws = await pool.query(`select 1 from crm.workspaces where id = $1`, [workspaceId]);
  if (!ws.rows[0]) throw new NotFoundError("Workspace");
  const result = await pool.query<ProfileRow>(
    `select ${PROFILE_COLUMNS}
       from crm.workspace_members m
       join crm.profiles p on p.id = m.user_id
       ${PROFILE_JOIN}
      where m.workspace_id = $1
      order by full_name asc`,
    [workspaceId],
  );
  return result.rows.map(profileToDto);
}

/** Replaces the member list. Only salespeople are members; admins already see everything. */
export async function setMembers(actor: Actor, workspaceId: string, userIds: string[]) {
  const ids = [...new Set(userIds)];
  await withTransaction(async (db) => {
    const ws = await db.query(`select 1 from crm.workspaces where id = $1 for update`, [workspaceId]);
    if (!ws.rows[0]) throw new NotFoundError("Workspace");

    const valid = await db.query<{ id: string }>(
      `select id from crm.profiles where id = any($1::uuid[]) and role = 'salesperson'`,
      [ids],
    );
    if (valid.rows.length !== ids.length) {
      const ok = new Set(valid.rows.map((r) => r.id));
      throw new ValidationError("Members must be existing salespeople.", { invalidUserIds: ids.filter((i) => !ok.has(i)) });
    }

    const before = await db.query<{ user_id: string }>(
      `select user_id from crm.workspace_members where workspace_id = $1`,
      [workspaceId],
    );
    const beforeIds = new Set(before.rows.map((r) => r.user_id));
    const added = ids.filter((i) => !beforeIds.has(i));
    const removed = [...beforeIds].filter((i) => !ids.includes(i));

    await db.query(`delete from crm.workspace_members where workspace_id = $1 and user_id = any($2::uuid[])`, [workspaceId, removed]);
    await db.query(
      `insert into crm.workspace_members (workspace_id, user_id, added_by)
       select $1, unnest($2::uuid[]), $3`,
      [workspaceId, added, actor.id],
    );
    if (added.length || removed.length) {
      await recordAdminAudit(db, actor, "workspace.members_changed", "workspace", workspaceId, { added, removed });
    }
  });
  return listMembers(workspaceId);
}
