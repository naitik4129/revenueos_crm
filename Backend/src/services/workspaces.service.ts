import type { Actor } from "../authMiddleware.js";
import { pool } from "../db.js";
import type { Queryable } from "../dto.js";
import { ensureWorkspaces, ownsOrMemberOfProjectSql } from "./platform-sync.service.js";

// Workspaces mirror platform projects one-to-one (crm_workspaces.platform_project_id). They are
// created automatically (ensureWorkspaces) and never managed in the CRM: who sees a workspace is
// derived from platform project ownership/membership. The admin manages projects and access on the
// RevenueOS platform.

export interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  platform_project_id: string | null;
  default_owner_id: string | null;
  default_meeting_email_template_id: string | null;
  default_meeting_whatsapp_template_id: string | null;
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
    defaultOwnerId: row.default_owner_id,
    defaultMeetingEmailTemplateId: row.default_meeting_email_template_id,
    defaultMeetingWhatsappTemplateId: row.default_meeting_whatsapp_template_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * The workspaces this user may use. Admins see every workspace (including inactive); everyone else
 * sees the active workspaces whose platform project they own or are a member of. Missing workspaces
 * for the user's platform projects are created first, so a new project shows up without any setup.
 */
export async function listWorkspaces(actor: Actor, db: Queryable = pool) {
  const isAdmin = actor.role === "admin";
  await ensureWorkspaces(db, { userId: actor.id, isAdmin });

  const result = isAdmin
    ? await db.query<WorkspaceRow>(`select * from crm_workspaces order by created_at asc`)
    : await db.query<WorkspaceRow>(
        // Platform project ownership/membership, plus the legacy crm_workspace_members path (empty
        // in production — nothing writes it now).
        `select w.* from crm_workspaces w
          where w.is_active = true
            and (
              (w.platform_project_id is not null and ${ownsOrMemberOfProjectSql("w.platform_project_id", "$1")})
              or exists (select 1 from crm_workspace_members m where m.workspace_id = w.id and m.user_id = $1)
            )
          order by w.created_at asc`,
        [actor.id],
      );
  return result.rows.map(workspaceToDto);
}
