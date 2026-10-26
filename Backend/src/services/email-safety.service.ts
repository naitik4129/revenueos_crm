import { createHmac, timingSafeEqual } from "node:crypto";
import { promises as dns } from "node:dns";
import type { Queryable } from "../dto.js";
import { env } from "../env.js";
import { autoPauseChannel } from "./send-policy.service.js";
import { addTimelineEvent, SYSTEM_ACTOR } from "./timeline.service.js";

/**
 * Email safety for workflow (nurture) sends: the unsubscribe link and its public page, the
 * Resend webhook (hard bounces and complaints block the address and can pause the workspace's
 * email channel), and the MX check before a send.
 */

// --- Unsubscribe token: the contact id + an HMAC of it (unguessable without the server key). ---

const unsubscribeKey = createHmac("sha256", Buffer.from(env.INTEGRATION_ENCRYPTION_KEY, "base64")).update("crm:unsubscribe-token").digest();
const tokenMac = (contactId: string) => createHmac("sha256", unsubscribeKey).update(contactId).digest().subarray(0, 16);

export function unsubscribeToken(contactId: string) {
  return `${Buffer.from(contactId.replace(/-/g, ""), "hex").toString("base64url")}.${tokenMac(contactId).toString("base64url")}`;
}

/** The contact id a token was issued for, or null for anything the CRM did not issue. */
export function verifyUnsubscribeToken(token: string): string | null {
  const [idPart, macPart] = token.split(".");
  if (!idPart || !macPart || token.split(".").length !== 2) return null;
  const hex = Buffer.from(idPart, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  const contactId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const given = Buffer.from(macPart, "base64url");
  const expected = tokenMac(contactId);
  return given.length === expected.length && timingSafeEqual(given, expected) ? contactId : null;
}

/** The public unsubscribe URL for a contact, or null when PUBLIC_API_URL is not set. */
export function unsubscribeUrl(contactId: string) {
  return env.PUBLIC_API_URL ? `${env.PUBLIC_API_URL.replace(/\/+$/, "")}/u/${unsubscribeToken(contactId)}` : null;
}

/** The link appended to a nurture email and the List-Unsubscribe headers (RFC 8058 one-click). */
export function withUnsubscribe(html: string, url: string) {
  return {
    html: `${html}\n<p style="font-size:12px;color:#888888;margin-top:24px">Don't want these emails? <a href="${url}">Unsubscribe</a></p>`,
    headers: { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

/** The contact behind a token and its workspace's name (for the page), or null. */
export async function unsubscribeTarget(db: Queryable, token: string) {
  const contactId = verifyUnsubscribeToken(token);
  if (!contactId) return null;
  const row = (
    await db.query<{ workspace: string; status: string | null }>(
      `select w.name as workspace, ch.status
         from crm_contacts c join crm_workspaces w on w.id = c.workspace_id
         left join crm_contact_channels ch on ch.contact_id = c.id and ch.channel = 'email'
        where c.id = $1`,
      [contactId],
    )
  ).rows[0];
  return row ? { contactId, workspace: row.workspace, unsubscribed: row.status === "unsubscribed" } : null;
}

/** Sets the contact's email channel to unsubscribed (once) with a timeline note. */
export async function unsubscribeContact(db: Queryable, contactId: string) {
  const changed = await db.query(
    `insert into crm_contact_channels (contact_id, channel, status, reason) values ($1, 'email', 'unsubscribed', 'Unsubscribed by email link')
     on conflict (contact_id, channel) do update set status = excluded.status, reason = excluded.reason, updated_by = null
       where crm_contact_channels.status <> 'unsubscribed'`,
    [contactId],
  );
  if (changed.rowCount) await addTimelineEvent(db, { contactId, kind: "system", title: "email contactability: unsubscribed", detail: "Unsubscribed by email link", ...SYSTEM_ACTOR });
}

// --- Sends, the Resend webhook and the auto-pause. ---

export async function recordEmailSend(
  db: Queryable,
  row: { workspaceId: string; contactId: string; scheduledActionId: string; providerMessageId: string; to: string },
) {
  await db.query(
    `insert into crm_email_sends (workspace_id, contact_id, scheduled_action_id, provider_message_id, to_email) values ($1, $2, $3, $4, $5)
     on conflict (provider_message_id) do nothing`,
    [row.workspaceId, row.contactId, row.scheduledActionId, row.providerMessageId, row.to],
  );
}

/** Svix signature check (Resend webhooks): HMAC-SHA256 of "id.timestamp.body" with the whsec_ secret, within 5 minutes. */
export function verifyResendSignature(
  rawBody: Buffer,
  headers: { id?: string; timestamp?: string; signature?: string },
  secret: string,
  now = Date.now(),
) {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;
  const sentAt = Number(headers.timestamp) * 1000;
  if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > 5 * 60_000) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${rawBody.toString("utf8")}`).digest();
  return headers.signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    const given = Buffer.from(value ?? "", "base64");
    return version === "v1" && given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export interface ResendEvent {
  type?: string;
  data?: { email_id?: string; bounce?: { type?: string; message?: string } };
}

/** Bounce + complaint rate over 7 days that pauses the email channel, and the sends it needs first. */
export const AUTO_PAUSE_RATE = 0.03;
export const AUTO_PAUSE_MIN_SENDS = 50;

/**
 * A hard bounce or a complaint for a nurture email: blocks that address (permanent_bounce /
 * unsubscribed), notes it on the contact, then checks the workspace's 7-day rate. Soft bounces,
 * other event types, unknown or repeated messages are ignored. Returns what it did.
 */
export async function handleResendEvent(db: Queryable, event: ResendEvent): Promise<"bounced" | "complained" | "ignored"> {
  const kind = event.type === "email.complained" ? "complained" : event.type === "email.bounced" && event.data?.bounce?.type === "Permanent" ? "bounced" : null;
  if (!kind || !event.data?.email_id) return "ignored";
  const column = kind === "bounced" ? "bounced_at" : "complained_at";
  const send = (
    await db.query<{ workspace_id: string; contact_id: string | null }>(
      `update crm_email_sends set ${column} = now() where provider_message_id = $1 and ${column} is null returning workspace_id, contact_id`,
      [event.data.email_id],
    )
  ).rows[0];
  if (!send) return "ignored";

  if (send.contact_id) {
    const [status, reason] = kind === "bounced" ? ["permanent_bounce", `Hard bounce: ${event.data.bounce?.message ?? "address rejected"}`] : ["unsubscribed", "Marked a nurture email as spam"];
    await db.query(
      `insert into crm_contact_channels (contact_id, channel, status, reason) values ($1, 'email', $2, $3)
       on conflict (contact_id, channel) do update set status = excluded.status, reason = excluded.reason, updated_by = null
         where crm_contact_channels.status <> 'unsubscribed'`,
      [send.contact_id, status, reason],
    );
    await addTimelineEvent(db, { contactId: send.contact_id, kind: "system", title: `email contactability: ${status}`, detail: reason, ...SYSTEM_ACTOR });
  }
  await autoPauseEmailIfNeeded(db, send.workspace_id);
  return kind;
}

/** Pauses the workspace's email channel when 7-day hard bounces + complaints reach the rate, and alerts admins. */
export async function autoPauseEmailIfNeeded(db: Queryable, workspaceId: string) {
  const stats = (
    await db.query<{ sends: number; bad: number }>(
      `select count(*)::int as sends, count(*) filter (where bounced_at is not null or complained_at is not null)::int as bad
         from crm_email_sends where workspace_id = $1 and sent_at >= now() - interval '7 days'`,
      [workspaceId],
    )
  ).rows[0]!;
  if (stats.sends < AUTO_PAUSE_MIN_SENDS || stats.bad / stats.sends < AUTO_PAUSE_RATE) return false;
  const reason = `Bounce + complaint rate ${((stats.bad / stats.sends) * 100).toFixed(1)}% over 7 days (${stats.bad} of ${stats.sends} sends).`;
  return autoPauseChannel(db, workspaceId, "email", reason);
}

// --- MX check ---

const MX_CACHE_MS = 24 * 60 * 60_000;
const mxCache = new Map<string, { ok: boolean; at: number }>();

/**
 * Whether the address's domain accepts mail (has MX records), cached a day per domain. Only a
 * definite "no such domain / no MX" is false; a DNS failure counts as true (never block on our
 * own outage).
 */
export async function domainHasMx(email: string, resolveMx: (domain: string) => Promise<unknown[]> = (d) => dns.resolveMx(d)) {
  const domain = email.split("@").pop()!.toLowerCase();
  const cached = mxCache.get(domain);
  if (cached && Date.now() - cached.at < MX_CACHE_MS) return cached.ok;
  let ok: boolean;
  try {
    ok = (await resolveMx(domain)).length > 0;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "ENOTFOUND" && code !== "ENODATA") return true;
    ok = false;
  }
  mxCache.set(domain, { ok, at: Date.now() });
  return ok;
}

/** Marks the contact's email channel invalid (no MX for its domain). */
export async function markEmailInvalid(db: Queryable, contactId: string, reason: string) {
  await db.query(
    `insert into crm_contact_channels (contact_id, channel, status, reason) values ($1, 'email', 'invalid', $2)
     on conflict (contact_id, channel) do update set status = 'invalid', reason = excluded.reason, updated_by = null
       where crm_contact_channels.status not in ('unsubscribed', 'permanent_bounce')`,
    [contactId, reason],
  );
}
