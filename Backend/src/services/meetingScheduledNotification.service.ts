import type { Queryable } from "../dto.js";
import { pool } from "../db.js";
import { NotFoundError } from "../errors.js";
import { getLeadRowOr404, type LeadRow } from "./leads.service.js";
import { toRenderMeeting, type MeetingRow } from "./meetings.service.js";
import { renderTemplate, type TemplateRenderLead } from "../domain/templateRenderer.js";
import { htmlToWhatsAppText } from "../domain/htmlToWhatsAppText.js";
import { sendEmail } from "../providers/email.provider.js";
import { sendWhatsApp } from "../providers/whatsapp.provider.js";
import { ProviderDeferredError } from "../providers/provider-errors.js";

/**
 * Sends the "meeting scheduled" confirmation to the lead on both channels,
 * using ONE fixed default template per channel (set once by an admin in
 * Templates — see the is_default_meeting_scheduled_* columns). Same division
 * of labor as proposalSending.service.ts's createAndSendProposal: email sent
 * synchronously inline (the API process can call sendEmail directly), the
 * WhatsApp side left "queued" for the worker's poll loop to drain (only the
 * worker process ever holds the live Baileys socket). Called as a
 * best-effort step after the meeting is already scheduled and synced to
 * Calendar — never blocks or fails meeting creation.
 */

const MAX_WHATSAPP_ATTEMPTS = 5;

interface NotificationTemplateRow {
  id: string;
  name: string;
  channel: "email" | "whatsapp";
  subject: string | null;
  body: string;
  is_active: boolean;
}

/**
 * Reads the meeting row directly (rather than meetings.service's
 * getMeetingRowOr404, which now requires a workspaceId) since this module's
 * entry points only ever receive a meetingId that a caller already resolved
 * within the correct workspace — the meeting's own workspace_id column is
 * then the source of truth for every downstream call in this file.
 */
async function getMeetingRowById(meetingId: string): Promise<MeetingRow> {
  const result = await pool.query<MeetingRow>(`select * from public.meetings where id = $1`, [meetingId]);
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Meeting");
  return row;
}

async function getDefaultTemplate(channel: "email" | "whatsapp"): Promise<NotificationTemplateRow | null> {
  const column = channel === "email" ? "is_default_meeting_scheduled_email" : "is_default_meeting_scheduled_whatsapp";
  const result = await pool.query<NotificationTemplateRow>(
    `select * from public.message_templates where ${column} = true and is_active = true limit 1`,
  );
  return result.rows[0] ?? null;
}

function toRenderLead(lead: LeadRow): TemplateRenderLead {
  return {
    firstName: lead.first_name,
    lastName: lead.last_name,
    company: lead.company,
    email: lead.email,
    phone: lead.phone,
    ownerName: lead.owner_name,
  };
}

async function sendMeetingEmailNow(meeting: MeetingRow, lead: LeadRow): Promise<void> {
  try {
    if (!lead.email) throw new Error("Email-eligible meeting notification has no lead email (invariant violation).");
    const template = await getDefaultTemplate("email");
    if (!template) {
      await pool.query(
        `update public.meetings set notify_email_status = 'skipped', notify_email_error = $2 where id = $1`,
        [meeting.id, "No default \"Meeting Scheduled\" email template is configured (Admin → Templates)."],
      );
      return;
    }
    const rendered = renderTemplate(template, toRenderLead(lead), toRenderMeeting(meeting));
    const subject = rendered.subject?.trim() || template.name;
    await sendEmail(meeting.workspace_id, { to: lead.email, subject, html: rendered.body });
    await pool.query(
      `update public.meetings set notify_email_status = 'sent', notify_email_sent_at = now(), notify_email_error = null where id = $1`,
      [meeting.id],
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await pool.query(`update public.meetings set notify_email_status = 'failed', notify_email_error = $2 where id = $1`, [meeting.id, message]);
  }
}

/** Best-effort — never throws, so a failure here can't undo the meeting/Calendar sync that already succeeded. */
export async function notifyMeetingScheduled(meetingId: string): Promise<void> {
  const meeting = await getMeetingRowById(meetingId);
  const lead = await getLeadRowOr404(pool, meeting.workspace_id, meeting.lead_id);

  if (lead.email) {
    await sendMeetingEmailNow(meeting, lead);
  } else {
    await pool.query(`update public.meetings set notify_email_status = 'skipped' where id = $1`, [meetingId]);
  }

  await pool.query(`update public.meetings set notify_whatsapp_status = $2 where id = $1`, [
    meetingId,
    lead.phone_e164 ? "queued" : "skipped",
  ]);
}

/** SKIP LOCKED claim, mirroring proposalSending.service.ts's claimQueuedProposalWhatsappSends. */
export async function claimQueuedMeetingWhatsappSends(db: Queryable, limit: number): Promise<MeetingRow[]> {
  const claimed = await db.query<MeetingRow>(
    `update public.meetings
        set notify_whatsapp_status = 'sending'
      where id in (
        select id from public.meetings
         where notify_whatsapp_status = 'queued'
           and (notify_whatsapp_next_attempt_at is null or notify_whatsapp_next_attempt_at <= now())
         order by created_at asc
         limit $1
         for update skip locked
      )
      returning *`,
    [limit],
  );
  return claimed.rows;
}

export async function processQueuedMeetingWhatsappSend(row: MeetingRow): Promise<void> {
  try {
    const lead = await getLeadRowOr404(pool, row.workspace_id, row.lead_id);
    if (lead.lifecycle_state === "do_not_contact" || !lead.phone_e164) {
      await pool.query(`update public.meetings set notify_whatsapp_status = 'failed', notify_whatsapp_error = $2 where id = $1`, [
        row.id,
        lead.lifecycle_state === "do_not_contact" ? "Lead is now Do Not Contact." : "Lead no longer has a WhatsApp-capable phone number.",
      ]);
      return;
    }
    const template = await getDefaultTemplate("whatsapp");
    if (!template) {
      await pool.query(
        `update public.meetings set notify_whatsapp_status = 'failed', notify_whatsapp_error = $2 where id = $1`,
        [row.id, "No default \"Meeting Scheduled\" WhatsApp template is configured (Admin → Templates)."],
      );
      return;
    }
    const rendered = renderTemplate(template, toRenderLead(lead), toRenderMeeting(row));
    const whatsappText = htmlToWhatsAppText(rendered.body);

    await sendWhatsApp(row.workspace_id, { source: { type: "meeting", id: row.id }, to: lead.phone_e164, body: whatsappText });

    await pool.query(
      `update public.meetings set notify_whatsapp_status = 'sent', notify_whatsapp_sent_at = now(), notify_whatsapp_error = null where id = $1`,
      [row.id],
    );
  } catch (err) {
    if (err instanceof ProviderDeferredError) {
      const attempts = row.notify_whatsapp_attempt_count + 1;
      if (attempts >= MAX_WHATSAPP_ATTEMPTS) {
        await pool.query(
          `update public.meetings
              set notify_whatsapp_status = 'failed', notify_whatsapp_attempt_count = $2, notify_whatsapp_error = $3
            where id = $1`,
          [row.id, attempts, `Gave up after ${attempts} attempts: ${err.message}`],
        );
        return;
      }
      await pool.query(
        `update public.meetings
            set notify_whatsapp_status = 'queued', notify_whatsapp_attempt_count = $2,
                notify_whatsapp_next_attempt_at = now() + ($3 || ' milliseconds')::interval, notify_whatsapp_error = $4
          where id = $1`,
        [row.id, attempts, String(err.retryAfterMs), err.message],
      );
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    await pool.query(`update public.meetings set notify_whatsapp_status = 'failed', notify_whatsapp_error = $2 where id = $1`, [row.id, message]);
  }
}
