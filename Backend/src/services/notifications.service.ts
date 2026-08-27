import type { Queryable } from "../dto.js";
import { NotFoundError } from "../errors.js";
import type { NotificationKind } from "../domain/enums.js";

export interface NotificationRow {
  id: string;
  recipient_id: string;
  title: string;
  detail: string | null;
  kind: NotificationKind;
  lead_id: string | null;
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
    leadId: row.lead_id ?? undefined,
    href: row.href ?? undefined,
    read: row.read,
    at: row.created_at.toISOString(),
  };
}

export async function listNotificationsFor(db: Queryable, recipientId: string) {
  const result = await db.query<NotificationRow>(
    `select * from public.notifications where recipient_id = $1 order by created_at desc limit 100`,
    [recipientId],
  );
  return result.rows.map(toDto);
}

export async function markNotificationRead(db: Queryable, recipientId: string, id: string) {
  const result = await db.query<NotificationRow>(
    `update public.notifications set read = true where id = $1 and recipient_id = $2 returning *`,
    [id, recipientId],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Notification");
  return toDto(row);
}

export async function markAllNotificationsRead(db: Queryable, recipientId: string) {
  await db.query(`update public.notifications set read = true where recipient_id = $1 and read = false`, [recipientId]);
  return listNotificationsFor(db, recipientId);
}
