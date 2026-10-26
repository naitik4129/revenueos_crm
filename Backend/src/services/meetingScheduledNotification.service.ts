import type { Queryable } from "../dto.js";
import { pool } from "../db.js";
import { NotFoundError } from "../errors.js";
import { dealRenderContext, getDealOr404, type DealRow } from "./deals.service.js";
import { toRenderMeeting, type MeetingRow } from "./meetings.service.js";
import { sendBlockReason } from "./consent.service.js";
import { renderTemplate } from "../domain/templateRenderer.js";
import { htmlToWhatsAppText } from "../domain/htmlToWhatsAppText.js";
import { sendEmail } from "../providers/email.provider.js";
import { sendWhatsApp } from "../providers/whatsapp.provider.js";
import { ProviderDeferredError } from "../providers/provider-errors.js";

/**
 * The "meeting scheduled" confirmation to the contact, with the workspace's default template per
 * channel (crm_workspaces.default_meeting_*_template_id). Email goes inline from the API; WhatsApp
 * is queued for the worker (the only process holding Baileys sockets). Best-effort: runs after the
 * meeting is saved and never throws. Every send re-checks consent right before it goes.
 */

const MAX_WHATSAPP_ATTEMPTS = 5;

interface NotificationTemplateRow {
  id: string;
  name: string;
  channel: "email" | "whatsapp";
  subject: string | null;
  body: string;
}

async function getMeetingRowById(meetingId: string): Promise<MeetingRow> {
  const row = (await pool.query<MeetingRow>(`select m.*, null as owner_name from crm_meetings m where m.id = $1`, [meetingId])).rows[0];
  if (!row) throw new NotFoundError("Meeting");
  return row;
}

/** The workspace's own active default template for the channel. */
async function getDefaultTemplate(workspaceId: string, channel: "email" | "whatsapp"): Promise<NotificationTemplateRow | null> {
  const column = channel === "email" ? "default_meeting_email_template_id" : "default_meeting_whatsapp_template_id";
  const result = await pool.query<NotificationTemplateRow>(
    `select t.id, t.name, t.channel, t.subject, t.body
       from crm_workspaces w join crm_message_templates t on t.id = w.${column} and t.workspace_id = w.id
      where w.id = $1 and t.is_active`,
    [workspaceId],
  );
  return result.rows[0] ?? null;
}

const setEmail = (id: string, status: string, error: string | null) =>
  pool.query(
    `update crm_meetings set notify_email_status = $2, notify_email_error = $3, notify_email_sent_at = case when $2 = 'sent' then now() else notify_email_sent_at end where id = $1`,
    [id, status, error],
  );
const setWhatsapp = (id: string, status: string, error: string | null) =>
  pool.query(
    `update crm_meetings set notify_whatsapp_status = $2, notify_whatsapp_error = $3, notify_whatsapp_sent_at = case when $2 = 'sent' then now() else notify_whatsapp_sent_at end where id = $1`,
    [id, status, error],
  );

async function sendMeetingEmailNow(meeting: MeetingRow, deal: DealRow): Promise<void> {
  try {
    const blocked = await sendBlockReason(pool, deal.contact_id, "email");
    if (blocked) return void (await setEmail(meeting.id, "skipped", blocked));
    const template = await getDefaultTemplate(meeting.workspace_id, "email");
    if (!template) return void (await setEmail(meeting.id, "skipped", 'No default "Meeting Scheduled" email template is set for this workspace.'));
    const rendered = renderTemplate(template, dealRenderContext(deal), toRenderMeeting(meeting));
    await sendEmail(meeting.workspace_id, { to: deal.email!, subject: rendered.subject?.trim() || template.name, html: rendered.body });
    await setEmail(meeting.id, "sent", null);
  } catch (err) {
    await setEmail(meeting.id, "failed", err instanceof Error ? err.message : String(err));
  }
}

export async function notifyMeetingScheduled(meetingId: string): Promise<void> {
  const meeting = await getMeetingRowById(meetingId);
  const deal = await getDealOr404(pool, meeting.workspace_id, meeting.deal_id);
  await sendMeetingEmailNow(meeting, deal);
  const blocked = await sendBlockReason(pool, deal.contact_id, "whatsapp");
  await setWhatsapp(meetingId, blocked ? "skipped" : "queued", blocked);
}

/** SKIP LOCKED claim of queued WhatsApp confirmations (worker). */
export async function claimQueuedMeetingWhatsappSends(db: Queryable, limit: number): Promise<MeetingRow[]> {
  const claimed = await db.query<MeetingRow>(
    `update crm_meetings
        set notify_whatsapp_status = 'sending'
      where id in (
        select id from crm_meetings
         where notify_whatsapp_status = 'queued'
           and (notify_whatsapp_next_attempt_at is null or notify_whatsapp_next_attempt_at <= now())
         order by created_at asc
         limit $1
         for update skip locked
      )
      returning *, null as owner_name, null as contact_name, null as company_name`,
    [limit],
  );
  return claimed.rows;
}

export async function processQueuedMeetingWhatsappSend(row: MeetingRow): Promise<void> {
  try {
    const deal = await getDealOr404(pool, row.workspace_id, row.deal_id);
    const blocked = await sendBlockReason(pool, deal.contact_id, "whatsapp");
    if (blocked) return void (await setWhatsapp(row.id, "failed", blocked));
    const template = await getDefaultTemplate(row.workspace_id, "whatsapp");
    if (!template) return void (await setWhatsapp(row.id, "failed", 'No default "Meeting Scheduled" WhatsApp template is set for this workspace.'));
    const rendered = renderTemplate(template, dealRenderContext(deal), toRenderMeeting(row));
    await sendWhatsApp(row.workspace_id, { source: { type: "meeting", id: row.id }, to: deal.phone_e164!, body: htmlToWhatsAppText(rendered.body) });
    await setWhatsapp(row.id, "sent", null);
  } catch (err) {
    if (err instanceof ProviderDeferredError) {
      const attempts = row.notify_whatsapp_attempt_count + 1;
      if (attempts >= MAX_WHATSAPP_ATTEMPTS) {
        await pool.query(`update crm_meetings set notify_whatsapp_status = 'failed', notify_whatsapp_attempt_count = $2, notify_whatsapp_error = $3 where id = $1`, [
          row.id,
          attempts,
          `Gave up after ${attempts} attempts: ${err.message}`,
        ]);
        return;
      }
      await pool.query(
        `update crm_meetings
            set notify_whatsapp_status = 'queued', notify_whatsapp_attempt_count = $2,
                notify_whatsapp_next_attempt_at = now() + ($3 || ' milliseconds')::interval, notify_whatsapp_error = $4
          where id = $1`,
        [row.id, attempts, String(err.retryAfterMs), err.message],
      );
      return;
    }
    await setWhatsapp(row.id, "failed", err instanceof Error ? err.message : String(err));
  }
}
