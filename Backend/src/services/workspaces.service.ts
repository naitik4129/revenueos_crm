import type { Actor } from "../authMiddleware.js";
import { pool, withTransaction } from "../db.js";
import type { Queryable } from "../dto.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors.js";
import { recordAdminAudit } from "./admin-audit.service.js";

export interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export function workspaceToDto(row: WorkspaceRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    isActive: row.is_active,
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

export async function listWorkspaces(db: Queryable = pool) {
  const result = await db.query<WorkspaceRow>(
    `select * from public.workspaces where is_active = true order by created_at asc`,
  );
  return result.rows.map(workspaceToDto);
}

async function uniqueSlug(db: Queryable, name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;
  for (;;) {
    const existing = await db.query<{ id: string }>(`select id from public.workspaces where slug = $1`, [candidate]);
    if (!existing.rows[0]) return candidate;
    candidate = `${base}-${suffix++}`;
  }
}

/**
 * Creates a workspace and seeds its per-workspace integration connection
 * rows (email/WhatsApp/Google Calendar), all disabled/unconfigured by
 * default — every reader in connections.service.ts assumes exactly one row
 * per workspace exists in each of these tables (mirroring how
 * 003_admin_integrations_baileys.sql and 006_google_calendar_meeting_sync.sql
 * originally seeded the single global row), so a workspace without these
 * rows would make those reads fail.
 */
export async function createWorkspace(actor: Actor, input: { name: string }) {
  const name = input.name.trim();
  if (!name) throw new ValidationError("Workspace name is required.", { field: "name" });

  return withTransaction(async (db) => {
    const existing = await db.query<{ id: string }>(`select id from public.workspaces where lower(name) = lower($1)`, [name]);
    if (existing.rows[0]) throw new ConflictError(`A workspace named "${name}" already exists.`, { field: "name" });

    const slug = await uniqueSlug(db, name);
    const result = await db.query<WorkspaceRow>(
      `insert into public.workspaces (id, name, slug) values (gen_random_uuid(), $1, $2) returning *`,
      [name, slug],
    );
    const workspace = result.rows[0]!;

    await db.query(`insert into public.integration_connections (workspace_id, id) values ($1, 'email')`, [workspace.id]);
    await db.query(`insert into public.whatsapp_connection (workspace_id) values ($1)`, [workspace.id]);
    await db.query(`insert into public.google_calendar_connection (workspace_id) values ($1)`, [workspace.id]);

    await recordAdminAudit(db, actor, "workspace.created", "workspace", workspace.id, { name: workspace.name });

    return workspaceToDto(workspace);
  });
}

export async function renameWorkspace(actor: Actor, id: string, input: { name: string }) {
  const name = input.name.trim();
  if (!name) throw new ValidationError("Workspace name is required.", { field: "name" });

  return withTransaction(async (db) => {
    const current = await db.query<WorkspaceRow>(`select * from public.workspaces where id = $1`, [id]);
    if (!current.rows[0]) throw new NotFoundError("Workspace");

    const existing = await db.query<{ id: string }>(
      `select id from public.workspaces where lower(name) = lower($1) and id <> $2`,
      [name, id],
    );
    if (existing.rows[0]) throw new ConflictError(`A workspace named "${name}" already exists.`, { field: "name" });

    const result = await db.query<WorkspaceRow>(
      `update public.workspaces set name = $2 where id = $1 returning *`,
      [id, name],
    );
    await recordAdminAudit(db, actor, "workspace.renamed", "workspace", id, { name });
    return workspaceToDto(result.rows[0]!);
  });
}
