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

/**
 * Tells a deal's owner; with no owner, every active salesperson member of the workspace.
 * Admins are never recipients (an admin owner, or an inactive one, gets nothing).
 */
export async function notifyOwnerOrMembers(
  db: Queryable,
  n: {
    workspaceId: string;
    ownerId: string | null;
    contactId: string | null;
    dealId: string | null;
    title: string;
    detail: string;
    kind: NotificationKind;
    href: string;
  },
) {
  await db.query(
    `insert into crm.notifications (workspace_id, recipient_id, contact_id, deal_id, title, detail, kind, href)
     select $1, p.id, $2, $3, $4, $5, $6, $8
       from crm.profiles p
      where p.is_active and p.role = 'salesperson'
        and (p.id = $7 or ($7::uuid is null and exists (
              select 1 from crm.workspace_members m where m.workspace_id = $1 and m.user_id = p.id)))`,
    [n.workspaceId, n.contactId, n.dealId, n.title, n.detail, n.kind, n.ownerId, n.href],
  );
}

/**
 * Sending-safety alerts (an automatic pause of a channel) go to every active admin: the one
 * exception to "admins get no notifications", since only admins can resume a channel.
 */
export async function notifyAdmins(db: Queryable, n: { workspaceId: string; title: string; detail: string; href: string }) {
  await db.query(
    `insert into crm.notifications (workspace_id, recipient_id, title, detail, kind, href)
     select $1, p.id, $2, $3, 'warning', $4 from crm.profiles p where p.is_active and p.role = 'admin'`,
    [n.workspaceId, n.title, n.detail, n.href],
  );
}
