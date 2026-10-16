import { getContentType, type WAMessage } from "baileys";
import { withTransaction } from "../db.js";
import { jidToPhoneE164 } from "../domain/phone.js";
import { addTimelineEvent, SYSTEM_ACTOR } from "./timeline.service.js";
import { advanceLifecycle } from "./contacts.service.js";

function messageTime(message: WAMessage) {
  const raw = message.messageTimestamp;
  const seconds = typeof raw === "number" ? raw : Number(raw?.toString() ?? 0);
  return new Date((seconds || Math.floor(Date.now() / 1000)) * 1000);
}

const REASON = "Inbound WhatsApp reply";

/**
 * A reply on a workspace's own WhatsApp number. Matched to that workspace's active contacts by
 * phone_e164 (never another workspace's). A matched reply stops automation on the contact's
 * open/nurture deals (automation -> manual, runs and pending actions cancelled), marks them
 * responded, moves the contact to `engaged` and tells the owner. Only metadata is stored,
 * never the message body. Ambiguous/unmatched replies wait for review.
 */
export async function processInboundUpsert(workspaceId: string, event: { messages: WAMessage[]; type: string; requestId?: string }) {
  if (event.type !== "notify" || event.requestId) return;
  for (const message of event.messages) {
    const id = message.key.id;
    const directJid = [message.key.remoteJid, message.key.remoteJidAlt].find((jid): jid is string => Boolean(jid?.endsWith("@s.whatsapp.net")));
    if (!id || !directJid || message.key.fromMe || !message.message) continue;
    const phone = jidToPhoneE164(directJid);
    if (!phone) continue;
    const type = getContentType(message.message) ?? "unknown";

    await withTransaction(async (db) => {
      await db.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [phone]);
      const inserted = await db.query(
        `insert into crm.whatsapp_inbound_events (workspace_id, message_id, sender_jid, sender_phone_e164, message_type, received_at, disposition)
         values ($1, $2, $3, $4, $5, $6, 'unmatched')
         on conflict (workspace_id, message_id) do nothing
         returning message_id`,
        [workspaceId, id, directJid, phone, type, messageTime(message).toISOString()],
      );
      if (inserted.rowCount === 0) return;

      const matches = await db.query<{ id: string; owner_id: string | null }>(
        `select id, owner_id from crm.contacts where workspace_id = $1 and phone_e164 = $2 and status = 'active' for update`,
        [workspaceId, phone],
      );
      const count = matches.rowCount ?? 0;
      const disposition = count === 0 ? "unmatched" : count === 1 ? "matched" : "ambiguous";
      await db.query(
        `update crm.whatsapp_inbound_events set match_count = $3, disposition = $4, contact_id = $5 where workspace_id = $1 and message_id = $2`,
        [workspaceId, id, count, disposition, count === 1 ? matches.rows[0]!.id : null],
      );

      for (const contact of matches.rows) {
        const deals = await db.query<{ id: string; owner_id: string | null }>(
          `update crm.deals set response_state = 'responded', automation_mode = 'manual', last_activity_at = now()
            where contact_id = $1 and outcome in ('open', 'nurture')
            returning id, owner_id`,
          [contact.id],
        );
        await db.query(
          `update crm.workflow_runs set status = 'cancelled', cancelled_at = now(), cancel_reason = $2, next_run_at = null
            where contact_id = $1 and status in ('running', 'waiting', 'paused')`,
          [contact.id, REASON],
        );
        await db.query(
          `update crm.scheduled_actions set status = 'cancelled', cancelled_at = now(), cancel_reason = $2
            where status in ('pending', 'due', 'paused', 'executing')
              and workflow_run_id in (select id from crm.workflow_runs where contact_id = $1)`,
          [contact.id, REASON],
        );
        await db.query(
          `insert into crm.contact_channels (contact_id, channel, status, reason) values ($1, 'whatsapp', 'reachable', 'Inbound reply received')
           on conflict (contact_id, channel) do update set status = 'reachable', reason = excluded.reason, updated_by = null`,
          [contact.id],
        );
        await db.query(`update crm.contacts set last_activity_at = now() where id = $1`, [contact.id]);
        await advanceLifecycle(db, contact.id, "engaged", SYSTEM_ACTOR);
        await addTimelineEvent(db, {
          contactId: contact.id,
          dealId: deals.rows[0]?.id ?? null,
          kind: "whatsapp",
          title: "WhatsApp reply received - automation stopped",
          metadata: { messageId: id, messageType: type, duplicatePhoneMatch: count > 1 },
          ...SYSTEM_ACTOR,
        });

        const owners = new Set([...deals.rows.map((d) => d.owner_id), contact.owner_id].filter((o): o is string => Boolean(o)));
        for (const owner of owners) {
          await db.query(
            `insert into crm.notifications (workspace_id, recipient_id, contact_id, deal_id, title, detail, kind, href)
             select $1, p.id, $3, $4, 'WhatsApp reply received', $5, $6, $7 from crm.profiles p where p.id = $2 and p.is_active and p.role = 'salesperson'`,
            [
              workspaceId,
              owner,
              contact.id,
              deals.rows[0]?.id ?? null,
              count > 1 ? "Automation stopped for several contacts sharing this number." : "Automation was switched to manual.",
              count > 1 ? "warning" : "info",
              `/contacts/${contact.id}`,
            ],
          );
        }
      }

      if (count > 1) {
        await db.query(
          `insert into crm.admin_audit_events (actor_email, action, target_type, target_id, metadata)
           values ('system@whatsapp.local', 'whatsapp.inbound_ambiguous', 'phone', $1, $2)`,
          [phone, { workspaceId, messageId: id, matchCount: count }],
        );
      }
    });
  }
}
