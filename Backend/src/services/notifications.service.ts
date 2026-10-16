import type { Queryable } from "../dto.js";
import { NotFoundError } from "../errors.js";
import type { NotificationKind } from "../domain/enums.js";

export interface NotificationRow {
  id: string;
  recipient_id: string;
  workspace_id: string;
  contact_id: string | null;
  deal_id: string | null;
  title: string;
  detail: string | null;
  kind: NotificationKind;
  href: string | null;
  read: boolean;
  created_at: Date;
}

function toDto(row: NotificationRow) {
  return {
    id: row.id,
    title: row.title,
    detail: row.detail ?? undefined,
    kind: row.kind,
    contactId: row.contact_id ?? undefined,
    dealId: row.deal_id ?? undefined,
    href: row.href ?? undefined,
    read: row.read,
    at: row.created_at.toISOString(),
  };
}

// Everything here is scoped to (recipient, current workspace). Admins are never recipients:
// every insert into crm.notifications selects active salespeople only.

export async function listNotificationsFor(db: Queryable, recipientId: string, workspaceId: string) {
  const result = await db.query<NotificationRow>(
    `select * from crm.notifications
      where recipient_id = $1 and workspace_id = $2
      order by created_at desc
      limit 100`,
    [recipientId, workspaceId],
  );
  return result.rows.map(toDto);
}

export async function markNotificationRead(db: Queryable, recipientId: string, workspaceId: string, id: string) {
  const result = await db.query<NotificationRow>(
    `update crm.notifications set read = true
      where id = $1 and recipient_id = $2 and workspace_id = $3
      returning *`,
    [id, recipientId, workspaceId],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Notification");
  return toDto(row);
}

export async function markAllNotificationsRead(db: Queryable, recipientId: string, workspaceId: string) {
  await db.query(`update crm.notifications set read = true where recipient_id = $1 and workspace_id = $2 and read = false`, [recipientId, workspaceId]);
  return listNotificationsFor(db, recipientId, workspaceId);
}
