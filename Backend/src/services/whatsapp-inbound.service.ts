import { getContentType, type WAMessage } from "baileys";
import { withTransaction } from "../db.js";
import { jidToPhoneE164 } from "../domain/phone.js";
import { addTimelineEvent, SYSTEM_ACTOR } from "./timeline.service.js";

function messageTime(message: WAMessage) {
  const raw = message.messageTimestamp;
  const seconds = typeof raw === "number" ? raw : Number(raw?.toString() ?? 0);
  return new Date((seconds || Math.floor(Date.now() / 1000)) * 1000);
}

export async function processInboundUpsert(event: { messages: WAMessage[]; type: string; requestId?: string }) {
  if (event.type !== "notify" || event.requestId) return;
  for (const message of event.messages) {
    const id = message.key.id;
    const directJid = [message.key.remoteJid, message.key.remoteJidAlt].find(
      (jid): jid is string => Boolean(jid?.endsWith("@s.whatsapp.net")),
    );
    if (!id || !directJid || message.key.fromMe || !message.message) continue;
    const phone = jidToPhoneE164(directJid);
    if (!phone) continue;
    const type = getContentType(message.message) ?? "unknown";

    await withTransaction(async (db) => {
      await db.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [phone]);
      const inserted = await db.query(
        `insert into public.whatsapp_inbound_events
          (message_id, sender_jid, sender_phone_e164, message_type, received_at, disposition)
         values ($1,$2,$3,$4,$5,'unmatched')
         on conflict (message_id) do nothing
         returning message_id`,
        [id, directJid, phone, type, messageTime(message).toISOString()],
      );
      if (inserted.rowCount === 0) return;

      const matches = await db.query<{ id: string; owner_id: string | null }>(
        `select id, owner_id from public.leads
          where phone_e164 = $1 and lifecycle_state = 'active' and merged_into_lead_id is null
          for update`,
        [phone],
      );
      const disposition = matches.rowCount === 0 ? "unmatched" : matches.rowCount === 1 ? "matched" : "ambiguous";
      await db.query(
        `update public.whatsapp_inbound_events set match_count = $2, disposition = $3 where message_id = $1`,
        [id, matches.rowCount, disposition],
      );

      for (const lead of matches.rows) {
        await db.query(
          `update public.leads
              set response_state = 'responded', automation_mode = 'manual', last_activity_at = now()
            where id = $1`,
          [lead.id],
        );
        await db.query(
          `update public.workflow_runs
              set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Inbound WhatsApp reply', next_run_at = null
            where lead_id = $1 and status in ('running','waiting','paused')`,
          [lead.id],
        );
        await db.query(
          `update public.scheduled_actions
              set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Inbound WhatsApp reply'
            where lead_id = $1 and status in ('pending','due','paused','executing')`,
          [lead.id],
        );
        await db.query(
          `insert into public.lead_contact_channels
            (lead_id, channel, status, reason, updated_by_name)
           values ($1, 'whatsapp', 'reachable', 'Inbound reply received', 'WhatsApp')
           on conflict (lead_id, channel) do update
             set status = 'reachable', reason = excluded.reason, updated_at = now(), updated_by = null, updated_by_name = 'WhatsApp'`,
          [lead.id],
        );
        await addTimelineEvent(db, {
          leadId: lead.id,
          kind: "whatsapp",
          title: "WhatsApp reply received - automation stopped",
          metadata: { messageId: id, messageType: type, duplicatePhoneMatch: matches.rowCount! > 1 },
          ...SYSTEM_ACTOR,
        });
        if (lead.owner_id) {
          await db.query(
            `insert into public.notifications (recipient_id, title, detail, kind, lead_id, href)
             values ($1, $2, $3, $4, $5, $6)`,
            [
              lead.owner_id,
              "WhatsApp reply received",
              matches.rowCount! > 1 ? "Automation stopped for multiple leads sharing this number." : "Automation was switched to manual.",
              matches.rowCount! > 1 ? "warning" : "info",
              lead.id,
              `/leads/${lead.id}`,
            ],
          );
        }
      }

      if (matches.rowCount! > 1) {
        await db.query(
          `insert into public.admin_audit_events (actor_email, action, target_type, target_id, metadata)
           values ('system@whatsapp.local', 'whatsapp.inbound_ambiguous', 'phone', $1, $2)`,
          [phone, { messageId: id, matchCount: matches.rowCount }],
        );
      }
    });
  }
}
