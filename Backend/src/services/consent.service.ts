import type { Queryable } from "../dto.js";

/** Channel statuses that block a send (crm.contact_channels). */
export const BLOCKED_EMAIL_STATUSES = ["permanent_bounce", "unsubscribed", "invalid"];
export const BLOCKED_WHATSAPP_STATUSES = ["invalid", "opted_out", "do_not_contact"];

/**
 * The consent check every real send runs immediately before handing a message to a provider:
 * the contact must be active (not DNC/merged), have an address for the channel, and the channel
 * must not be blocked (for WhatsApp the phone channel's do_not_contact blocks too).
 * Returns why the send is blocked, or null when it may go.
 */
export async function sendBlockReason(db: Queryable, contactId: string, channel: "email" | "whatsapp"): Promise<string | null> {
  const row = (
    await db.query<{ status: string; email: string | null; phone_e164: string | null; channel_status: string | null; phone_status: string | null }>(
      `select c.status, c.email, c.phone_e164,
              (select status from crm.contact_channels where contact_id = c.id and channel = $2::crm.contact_channel) as channel_status,
              (select status from crm.contact_channels where contact_id = c.id and channel = 'phone') as phone_status
         from crm.contacts c where c.id = $1`,
      [contactId, channel],
    )
  ).rows[0];
  if (!row) return "Contact not found.";
  if (row.status !== "active") return row.status === "do_not_contact" ? "Contact is Do Not Contact." : `Contact is ${row.status}.`;
  if (channel === "email") {
    if (!row.email) return "Contact has no email address.";
    if (row.channel_status && BLOCKED_EMAIL_STATUSES.includes(row.channel_status)) return `Email channel is "${row.channel_status}".`;
  } else {
    if (!row.phone_e164) return "Contact has no valid phone number.";
    if (row.channel_status && BLOCKED_WHATSAPP_STATUSES.includes(row.channel_status)) return `WhatsApp channel is "${row.channel_status}".`;
    if (row.phone_status === "do_not_contact") return `Phone channel is "do_not_contact".`;
  }
  return null;
}
