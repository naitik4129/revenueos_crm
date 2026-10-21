import type { Queryable } from "../dto.js";
import { autoPauseChannel } from "./send-policy.service.js";

/**
 * WhatsApp safety: workflow WhatsApp goes only to engaged contacts, a STOP reply opts the number
 * out, and send failures auto-pause the channel (logout and restrictions pause it in the manager).
 */

export const NOT_ENGAGED = "Not engaged on WhatsApp: no inbound reply, connected call or opt-in.";

/** Null when the contact replied on WhatsApp, had a connected call (human or AI) or opted in; else why not. */
export async function whatsappNotEngagedReason(db: Queryable, contactId: string): Promise<string | null> {
  const row = (
    await db.query<{ engaged: boolean }>(
      `select exists (select 1 from crm.whatsapp_inbound_events where contact_id = $1 and disposition = 'matched')
           or exists (select 1 from crm.calls where contact_id = $1 and connected)
           or exists (select 1 from crm.contact_channels where contact_id = $1 and channel = 'whatsapp' and status = 'opted_in') as engaged`,
      [contactId],
    )
  ).rows[0];
  return row?.engaged ? null : NOT_ENGAGED;
}

const STOP_WORDS = new Set(["stop", "unsubscribe", "band karo"]);

/** Whether an inbound text is an opt-out: STOP / UNSUBSCRIBE / "band karo", any case, trimmed, trailing . or ! ignored. */
export function isStopReply(text: string | null | undefined) {
  if (!text) return false;
  return STOP_WORDS.has(text.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!]+$/, "").trim());
}

export const OPT_OUT_CONFIRMATION = "You're unsubscribed and won't get more WhatsApp messages from us.";

/** Failed sends in one IST day that pause the WhatsApp channel. */
export const WHATSAPP_FAILURES_TO_PAUSE = 5;

/** Counts today's (IST) failed WhatsApp sends and pauses the channel at the limit. */
export async function pauseWhatsAppOnFailures(db: Queryable, workspaceId: string) {
  const failed = (
    await db.query<{ n: number }>(
      `select count(*)::int as n from crm.whatsapp_outbound_messages
        where workspace_id = $1 and status = 'failed' and last_error is distinct from 'Recipient is not on WhatsApp'
          and updated_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'`,
      [workspaceId],
    )
  ).rows[0]!.n;
  if (failed < WHATSAPP_FAILURES_TO_PAUSE) return false;
  return autoPauseChannel(db, workspaceId, "whatsapp", `${failed} WhatsApp sends failed today (limit ${WHATSAPP_FAILURES_TO_PAUSE}).`);
}
