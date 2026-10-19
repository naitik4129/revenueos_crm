/**
 * Brain intake (/brain/v1): QuickICP companies/people, Quickhowl AI calls, Email Tool events and
 * qualified handovers, written into one workspace (the API key's). Rules (CLAUDE.md, Brain intake):
 *  - match a contact by external ref, then email, then E.164 phone; a merged contact -> its target
 *  - brain data only fills empty fields, never overwrites
 *  - lifecycle moves forward only; consent (unsubscribe, bounce, AI-call DNC) is applied
 *  - every item is idempotent by its external id
 */
import { z } from "zod";
import type { Queryable } from "../dto.js";
import { withTransaction } from "../db.js";
import { AppError, NotFoundError, ValidationError } from "../errors.js";
import { env } from "../env.js";
import { normalizeEmail } from "../domain/email.js";
import { EMAIL_STATUSES } from "../domain/enums.js";
import { normalizePhoneE164 } from "../domain/phone.js";
import { normalizeDomain } from "./companies.service.js";
import { advanceLifecycle, markDnc } from "./contacts.service.js";
import { createDeal } from "./deals.service.js";
import { addTimelineEvent, BRAIN_ACTOR } from "./timeline.service.js";

export const BRAIN_SOURCES = ["quickicp", "quickhowl", "email_tool"] as const;
export const EMAIL_EVENTS = EMAIL_STATUSES;
export const MAX_BATCH = 500;

// --- Payloads ---------------------------------------------------------------------------

const text = (max = 2000) => z.string().trim().max(max).nullable().optional();
const externalId = z.string().trim().min(1).max(300);
const timestamp = z.string().datetime({ offset: true });
const ref = z.object({ source: z.enum(BRAIN_SOURCES), externalId });

const contactData = {
  fullName: text(300),
  firstName: text(200),
  lastName: text(200),
  jobTitle: text(300),
  email: text(320),
  phone: text(50),
  linkedinUrl: text(500),
  country: text(100),
  location: text(300),
  companyRef: ref.optional(),
};

export const companyItem = z.object({
  source: z.enum(BRAIN_SOURCES),
  externalId,
  name: z.string().trim().min(1).max(300),
  website: text(500),
  domain: text(300),
  industry: text(300),
  location: text(300),
  city: text(200),
  country: text(100),
  headcount: z.number().int().min(0).nullable().optional(),
  phone: text(50),
  linkedinUrl: text(500),
});

export const contactItem = z.object({ source: z.enum(BRAIN_SOURCES), externalId, ...contactData });

/** How a call/email/handover names its contact: the QuickICP id and/or email/phone, optionally with data to create it. */
const contactRef = z
  .object({ source: z.enum(BRAIN_SOURCES).optional(), externalId: externalId.optional(), ...contactData })
  .refine((c) => c.externalId || c.email || c.phone, { message: "contact needs an externalId, email or phone" })
  .refine((c) => !c.externalId || c.source, { message: "contact.externalId needs contact.source" });

export const callItem = z.object({
  source: z.literal("quickhowl"),
  externalId,
  contact: contactRef,
  direction: z.enum(["outbound", "inbound"]).optional(),
  connected: z.boolean(),
  outcome: text(200),
  startedAt: timestamp.optional(),
  durationSeconds: z.number().int().min(0).nullable().optional(),
  summary: text(20_000),
  sentiment: text(100),
  transcript: z.string().max(500_000).nullable().optional(),
  recordingUrl: text(2000),
  /** The person asked not to be contacted again. */
  dnc: z.boolean().optional(),
});

export const emailEventItem = z.object({
  source: z.literal("email_tool"),
  /** One message = one campaign step to one contact; all its events share this id. */
  messageId: externalId,
  contact: contactRef,
  campaignRef: text(300),
  campaignName: text(300),
  step: z.number().int().positive().optional(),
  subject: text(1000),
  event: z.enum(EMAIL_EVENTS),
  occurredAt: timestamp,
  replyText: z.string().max(100_000).nullable().optional(),
});

export const handoverItem = z.object({
  source: z.enum(BRAIN_SOURCES),
  externalId,
  contact: contactRef,
  ownerEmail: z.string().email().optional(),
  summary: z.string().trim().min(1).max(20_000),
  notes: z.string().trim().max(20_000).optional(),
  /** Deal value in INR; fills the deal's amount only when it is empty. */
  amount: z.number().nonnegative().max(999_999_999_999.99).optional(),
});

type ContactData = z.infer<typeof contactRef>;
type Status = "created" | "updated" | "unchanged";

// --- Batch runner -------------------------------------------------------------------------

export interface ItemResult {
  index: number;
  externalId?: string;
  status: Status | "error";
  id?: string | null;
  error?: { code: string; message: string };
}

/** Details stay in the server log; the brain gets a code and a short message only. */
function logItemError(workspaceId: string, index: number, ref: string | undefined, err: unknown) {
  if (env.NODE_ENV !== "test") console.error(`[brain] workspace ${workspaceId} item ${index} (${ref ?? "no id"}) failed:`, err);
}

/** Each item is validated and written in its own transaction; one bad item never fails the batch. */
export async function runBatch<T>(
  workspaceId: string,
  items: unknown[],
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  handle: (db: Queryable, workspaceId: string, item: T) => Promise<{ status: Status; id: string | null }>,
) {
  const results: ItemResult[] = [];
  for (const [index, raw] of items.entries()) {
    const r = raw as { externalId?: unknown; messageId?: unknown } | null;
    const ref = typeof r?.externalId === "string" ? r.externalId : typeof r?.messageId === "string" ? r.messageId : undefined;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "item"))].slice(0, 5);
      logItemError(workspaceId, index, ref, parsed.error.flatten());
      results.push({ index, externalId: ref, status: "error", error: { code: "invalid_input", message: `Invalid: ${fields.join(", ")}` } });
      continue;
    }
    try {
      results.push({ index, externalId: ref, ...(await withTransaction((db) => handle(db, workspaceId, parsed.data))) });
    } catch (err) {
      logItemError(workspaceId, index, ref, err);
      const error = err instanceof AppError ? { code: err.code, message: err.message } : { code: "internal_error", message: "Item failed." };
      results.push({ index, externalId: ref, status: "error", error });
    }
  }
  const counts = { created: 0, updated: 0, unchanged: 0, error: 0 };
  for (const r of results) counts[r.status]++;
  return { counts, results };
}

// --- Matching -------------------------------------------------------------------------------

function cleanContact(c: ContactData) {
  const [first, ...rest] = (c.fullName ?? "").split(/\s+/).filter(Boolean);
  const email = c.email ? normalizeEmail(c.email) : null;
  const phoneE164 = c.phone ? normalizePhoneE164(c.phone) : null;
  return {
    firstName: c.firstName || first || null,
    lastName: c.lastName || rest.join(" ") || null,
    jobTitle: c.jobTitle || null,
    // Invalid email/phone from the brain are dropped, not stored.
    email,
    phone: phoneE164 ? c.phone!.trim() : null,
    phoneE164,
    linkedinUrl: c.linkedinUrl || null,
    country: c.country || null,
    location: c.location || null,
  };
}

async function refTarget(db: Queryable, workspaceId: string, kind: "company" | "contact", source: string, id: string) {
  const r = await db.query<{ target: string }>(
    `select ${kind}_id as target from crm.external_refs
      where workspace_id = $1 and source = $2 and external_id = $3 and ${kind}_id is not null`,
    [workspaceId, source, id],
  );
  return r.rows[0]?.target ?? null;
}

/** External ref -> email -> phone; then follows merged contacts to their target. */
async function findContact(db: Queryable, workspaceId: string, c: ContactData, clean: ReturnType<typeof cleanContact>) {
  let id = c.source && c.externalId ? await refTarget(db, workspaceId, "contact", c.source, c.externalId) : null;
  if (!id && clean.email) {
    id = (await db.query<{ id: string }>(`select id from crm.contacts where workspace_id = $1 and lower(email) = $2`, [workspaceId, clean.email])).rows[0]?.id ?? null;
  }
  if (!id && clean.phoneE164) {
    id = (await db.query<{ id: string }>(`select id from crm.contacts where workspace_id = $1 and phone_e164 = $2`, [workspaceId, clean.phoneE164])).rows[0]?.id ?? null;
  }
  for (let hops = 0; id && hops < 10; hops++) {
    const row = (await db.query<{ merged_into_contact_id: string | null }>(`select merged_into_contact_id from crm.contacts where id = $1`, [id])).rows[0];
    if (!row?.merged_into_contact_id) break;
    id = row.merged_into_contact_id;
  }
  return id;
}

async function addRef(db: Queryable, workspaceId: string, kind: "company" | "contact", entityId: string, source: string, externalId: string) {
  await db.query(
    `insert into crm.external_refs (workspace_id, ${kind}_id, source, external_id) values ($1, $2, $3, $4) on conflict do nothing`,
    [workspaceId, entityId, source, externalId],
  );
}

/** Finds the contact (or creates it as a prospect) and fills only its empty fields. */
export async function upsertContact(db: Queryable, workspaceId: string, c: ContactData): Promise<{ id: string; status: Status }> {
  const clean = cleanContact(c);
  const companyId = c.companyRef ? await refTarget(db, workspaceId, "company", c.companyRef.source, c.companyRef.externalId) : null;
  let id = await findContact(db, workspaceId, c, clean);
  let status: Status = "updated";

  if (id) {
    // Each field is filled only when empty; email/phone only when no other contact holds them.
    await db.query(
      `update crm.contacts t set
          first_name = case when t.first_name = 'Unknown' and $2::text is not null then $2 else t.first_name end,
          last_name = case when t.last_name = '' then coalesce($3, '') else t.last_name end,
          job_title = coalesce(t.job_title, $4),
          email = coalesce(t.email, case when not exists (
            select 1 from crm.contacts o where o.workspace_id = t.workspace_id and lower(o.email) = $5) then $5 end),
          phone = case when t.phone is null and $7::text is not null and not exists (
            select 1 from crm.contacts o where o.workspace_id = t.workspace_id and o.phone_e164 = $7) then $6 else t.phone end,
          phone_e164 = case when t.phone is null and $7::text is not null and not exists (
            select 1 from crm.contacts o where o.workspace_id = t.workspace_id and o.phone_e164 = $7) then $7 else t.phone_e164 end,
          linkedin_url = coalesce(t.linkedin_url, $8),
          country = coalesce(t.country, $9),
          location = coalesce(t.location, $10),
          company_id = coalesce(t.company_id, $11)
        where t.id = $1`,
      [id, clean.firstName, clean.lastName, clean.jobTitle, clean.email, clean.phone, clean.phoneE164, clean.linkedinUrl, clean.country, clean.location, companyId],
    );
  } else {
    if (!clean.email && !clean.phoneE164 && !clean.linkedinUrl) {
      throw c.externalId
        ? new NotFoundError("Contact (send it to /brain/v1/contacts first, or include an email, phone or LinkedIn URL)")
        : new ValidationError("A new contact needs a valid email, phone or LinkedIn URL.");
    }
    id = (
      await db.query<{ id: string }>(
        `insert into crm.contacts
          (workspace_id, company_id, first_name, last_name, job_title, email, phone, phone_e164, linkedin_url, country, location, source)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'brain') returning id`,
        [workspaceId, companyId, clean.firstName ?? "Unknown", clean.lastName ?? "", clean.jobTitle, clean.email, clean.phone, clean.phoneE164, clean.linkedinUrl, clean.country, clean.location],
      )
    ).rows[0]!.id;
    await addTimelineEvent(db, { contactId: id, kind: "system", title: "Contact Created", detail: "From the RevenueOS brain", ...BRAIN_ACTOR });
    status = "created";
  }
  if (c.source && c.externalId) await addRef(db, workspaceId, "contact", id, c.source, c.externalId);
  return { id, status };
}

// --- Handlers ----------------------------------------------------------------------------------

export async function upsertCompany(db: Queryable, workspaceId: string, item: z.infer<typeof companyItem>) {
  const domain = normalizeDomain(item.domain ?? item.website);
  let id = await refTarget(db, workspaceId, "company", item.source, item.externalId);
  if (!id && domain) {
    id = (await db.query<{ id: string }>(`select id from crm.companies where workspace_id = $1 and lower(domain) = $2`, [workspaceId, domain])).rows[0]?.id ?? null;
  }
  let status: Status = "updated";
  const values = [item.website || null, item.industry || null, item.location || null, item.city || null, item.country || null, item.headcount ?? null, item.phone || null, item.linkedinUrl || null];

  if (id) {
    await db.query(
      `update crm.companies t set
          domain = coalesce(t.domain, case when not exists (
            select 1 from crm.companies o where o.workspace_id = t.workspace_id and lower(o.domain) = $2) then $2 end),
          website = coalesce(t.website, $3), industry = coalesce(t.industry, $4), location = coalesce(t.location, $5),
          city = coalesce(t.city, $6), country = coalesce(t.country, $7), headcount = coalesce(t.headcount, $8),
          phone = coalesce(t.phone, $9), linkedin_url = coalesce(t.linkedin_url, $10)
        where t.id = $1`,
      [id, domain, ...values],
    );
  } else {
    id = (
      await db.query<{ id: string }>(
        `insert into crm.companies
          (workspace_id, name, domain, website, industry, location, city, country, headcount, phone, linkedin_url, source)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'brain') returning id`,
        [workspaceId, item.name, domain, ...values],
      )
    ).rows[0]!.id;
    await addTimelineEvent(db, { companyId: id, kind: "system", title: "Company Created", detail: "From the RevenueOS brain", ...BRAIN_ACTOR });
    status = "created";
  }
  await addRef(db, workspaceId, "company", id, item.source, item.externalId);
  return { status, id };
}

/** AI call: activity only (no human call routing). Re-sends update the same call row. */
export async function upsertCall(db: Queryable, workspaceId: string, item: z.infer<typeof callItem>) {
  const contact = await upsertContact(db, workspaceId, item.contact);
  const call = (
    await db.query<{ id: string; inserted: boolean }>(
      `insert into crm.calls
        (workspace_id, contact_id, source, connected, direction, occurred_at, duration_seconds, ai_outcome,
         summary, sentiment, transcript, recording_url, external_source, external_id)
       values ($1, $2, 'ai', $3, $4, coalesce($5::timestamptz, now()), $6, $7, $8, $9, $10, $11, 'quickhowl', $12)
       on conflict (workspace_id, external_source, external_id) where external_id is not null
       do update set connected = excluded.connected,
                     direction = coalesce(excluded.direction, calls.direction),
                     occurred_at = case when $5::timestamptz is null then calls.occurred_at else excluded.occurred_at end,
                     duration_seconds = coalesce(excluded.duration_seconds, calls.duration_seconds),
                     ai_outcome = coalesce(excluded.ai_outcome, calls.ai_outcome),
                     summary = coalesce(excluded.summary, calls.summary),
                     sentiment = coalesce(excluded.sentiment, calls.sentiment),
                     transcript = coalesce(excluded.transcript, calls.transcript),
                     recording_url = coalesce(excluded.recording_url, calls.recording_url)
       returning id, (xmax = 0) as inserted`,
      [
        workspaceId,
        contact.id,
        item.connected,
        item.direction ?? null,
        item.startedAt ?? null,
        item.durationSeconds ?? null,
        item.outcome || null,
        item.summary || null,
        item.sentiment || null,
        item.transcript ?? null,
        item.recordingUrl || null,
        item.externalId,
      ],
    )
  ).rows[0]!;

  if (call.inserted) {
    await addTimelineEvent(db, {
      contactId: contact.id,
      kind: "call",
      title: item.connected ? "AI Call (connected)" : "AI Call (not connected)",
      detail: item.summary || item.outcome || null,
      relatedCallId: call.id,
      occurredAt: item.startedAt ? new Date(item.startedAt) : undefined,
      ...BRAIN_ACTOR,
    });
  }
  await advanceLifecycle(db, contact.id, item.connected ? "engaged" : "contacted", BRAIN_ACTOR);
  if (item.dnc) await markDnc(db, BRAIN_ACTOR, workspaceId, contact.id, { reason: "Asked not to be contacted (AI call)" });
  return { status: (call.inserted ? "created" : "updated") as Status, id: call.id };
}

/**
 * Email Tool event. One row per message; its status only moves up (enum order), each event
 * timestamp is kept from the first time it arrived.
 */
export async function upsertEmailEvent(db: Queryable, workspaceId: string, item: z.infer<typeof emailEventItem>) {
  const contact = await upsertContact(db, workspaceId, item.contact);
  const at = `${item.event}_at`; // from the EMAIL_EVENTS whitelist
  const before = (
    await db.query<{ seen: boolean }>(
      `select ${at} is not null as seen from crm.email_activities where workspace_id = $1 and external_source = 'email_tool' and external_id = $2`,
      [workspaceId, item.messageId],
    )
  ).rows[0];

  const row = (
    await db.query<{ id: string }>(
      `insert into crm.email_activities
        (workspace_id, contact_id, external_source, external_id, campaign_ref, campaign_name, step, subject, status, reply_text, ${at})
       values ($1, $2, 'email_tool', $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (workspace_id, external_source, external_id) where external_id is not null
       do update set status = greatest(email_activities.status, excluded.status),
                     ${at} = coalesce(email_activities.${at}, excluded.${at}),
                     reply_text = coalesce(email_activities.reply_text, excluded.reply_text),
                     campaign_ref = coalesce(email_activities.campaign_ref, excluded.campaign_ref),
                     campaign_name = coalesce(email_activities.campaign_name, excluded.campaign_name),
                     step = coalesce(email_activities.step, excluded.step),
                     subject = coalesce(email_activities.subject, excluded.subject)
       returning id`,
      [
        workspaceId,
        contact.id,
        item.messageId,
        item.campaignRef || null,
        item.campaignName || null,
        item.step ?? null,
        item.subject || null,
        item.event,
        item.event === "replied" ? item.replyText ?? null : null,
        item.occurredAt,
      ],
    )
  ).rows[0]!;

  await advanceLifecycle(db, contact.id, item.event === "replied" ? "engaged" : "contacted", BRAIN_ACTOR);
  if (item.event === "unsubscribed") await setEmailChannel(db, contact.id, "unsubscribed", "Unsubscribed from a campaign email");
  if (item.event === "bounced") await setEmailChannel(db, contact.id, "permanent_bounce", "Campaign email bounced");

  const firstTime = !before?.seen;
  if (firstTime && (item.event === "replied" || item.event === "bounced" || item.event === "unsubscribed")) {
    const titles = { replied: "Replied to Campaign Email", bounced: "Campaign Email Bounced", unsubscribed: "Unsubscribed" } as const;
    await addTimelineEvent(db, {
      contactId: contact.id,
      kind: "email",
      title: titles[item.event],
      detail: item.event === "replied" ? item.replyText || item.subject || null : item.campaignName || item.subject || null,
      occurredAt: new Date(item.occurredAt),
      ...BRAIN_ACTOR,
    });
  }
  return { status: (before ? "updated" : "created") as Status, id: row.id };
}

/** Never downgrades an unsubscribe to a bounce. */
async function setEmailChannel(db: Queryable, contactId: string, status: "unsubscribed" | "permanent_bounce", reason: string) {
  await db.query(
    `insert into crm.contact_channels (contact_id, channel, status, reason) values ($1, 'email', $2, $3)
     on conflict (contact_id, channel) do update set status = excluded.status, reason = excluded.reason
       where contact_channels.status <> 'unsubscribed'`,
    [contactId, status, reason],
  );
}

/** ownerEmail if that user is an active salesperson member, else the workspace default owner, else nobody. */
async function handoverOwner(db: Queryable, workspaceId: string, ownerEmail: string | undefined): Promise<string | null> {
  if (ownerEmail) {
    const member = await db.query<{ id: string }>(
      `select p.id from crm.profiles p
         join public.revenueos_profiles rp on rp.id = p.id
         join crm.workspace_members m on m.user_id = p.id and m.workspace_id = $1
        where lower(rp.email) = lower($2) and p.is_active and p.role = 'salesperson'`,
      [workspaceId, ownerEmail],
    );
    if (member.rows[0]) return member.rows[0].id;
  }
  const fallback = await db.query<{ id: string }>(
    `select p.id from crm.workspaces w join crm.profiles p on p.id = w.default_owner_id and p.is_active where w.id = $1`,
    [workspaceId],
  );
  return fallback.rows[0]?.id ?? null;
}

/**
 * Qualified handover: reuses the contact's open deal, else reopens its parked (nurture) deal,
 * else creates one. Idempotent by the handover's own external id (kept on its timeline event).
 */
export async function applyHandover(db: Queryable, workspaceId: string, item: z.infer<typeof handoverItem>) {
  const done = await db.query<{ deal_id: string | null }>(
    `select deal_id from crm.timeline_events where workspace_id = $1 and external_source = $2 and external_id = $3`,
    [workspaceId, item.source, item.externalId],
  );
  if (done.rows[0]) return { status: "unchanged" as Status, id: done.rows[0].deal_id };

  const contact = await upsertContact(db, workspaceId, item.contact);
  const ownerId = await handoverOwner(db, workspaceId, item.ownerEmail);
  let status: Status = "updated";

  const open = (await db.query<{ id: string }>(`select id from crm.deals where contact_id = $1 and outcome = 'open'`, [contact.id])).rows[0];
  const parked = open
    ? undefined
    : (await db.query<{ id: string }>(`select id from crm.deals where contact_id = $1 and outcome = 'nurture' order by updated_at desc limit 1`, [contact.id])).rows[0];
  let dealId: string;
  if (open) {
    dealId = open.id;
  } else if (parked) {
    dealId = parked.id;
    await db.query(`update crm.deals set outcome = 'open', automation_mode = 'manual', last_activity_at = now() where id = $1`, [dealId]);
    await addTimelineEvent(db, { dealId, kind: "system", title: "Reopened", detail: "Qualified handover from the brain", ...BRAIN_ACTOR });
  } else {
    dealId = (await createDeal(db, BRAIN_ACTOR, workspaceId, { contactId: contact.id, ownerId })).id;
    status = "created";
  }
  // An existing owner is kept; an unowned deal gets the handover owner.
  const owner = (
    await db.query<{ owner_id: string | null }>(
      `update crm.deals set owner_id = coalesce(owner_id, $2), amount = coalesce(amount, $3), last_activity_at = now()
        where id = $1 returning owner_id`,
      [dealId, ownerId, item.amount ?? null],
    )
  ).rows[0]!.owner_id;

  await advanceLifecycle(db, contact.id, "qualified", BRAIN_ACTOR);
  if (item.notes) {
    await db.query(`insert into crm.notes (workspace_id, contact_id, deal_id, body) values ($1, $2, $3, $4)`, [workspaceId, contact.id, dealId, item.notes]);
  }
  await addTimelineEvent(db, {
    dealId,
    kind: "handover",
    title: "Qualified Handover",
    detail: item.summary,
    external: { source: item.source, id: item.externalId },
    ...BRAIN_ACTOR,
  });

  // The owner is told; with no owner every active salesperson member is (admins never get notifications).
  await db.query(
    `insert into crm.notifications (workspace_id, recipient_id, contact_id, deal_id, title, detail, kind, href)
     select $1, p.id, $2, $3, 'New qualified handover', $4, 'success', $6
       from crm.profiles p
      where p.is_active and p.role = 'salesperson'
        and (p.id = $5 or ($5::uuid is null and exists (
              select 1 from crm.workspace_members m where m.workspace_id = $1 and m.user_id = p.id)))`,
    [workspaceId, contact.id, dealId, item.summary.slice(0, 500), owner, `/deals/${dealId}`],
  );
  return { status, id: dealId };
}

// --- Suppressions --------------------------------------------------------------------------------

const BLOCKED_CHANNEL = `((ch.channel = 'email' and ch.status in ('unsubscribed', 'permanent_bounce'))
   or (ch.channel = 'phone' and ch.status = 'do_not_contact')
   or (ch.channel = 'whatsapp' and ch.status in ('do_not_contact', 'opted_out')))`;

/**
 * Who the brain must not contact. Without `since`: the full current list. With `since`: every
 * contact whose suppression changed after it, including lifts (status "lifted"), so the brain
 * can unblock. A DNC lift comes from dnc_events; a channel set back to an allowed status after
 * `since` counts as a lift (channels keep no history). A contact still blocked for another
 * reason is reported as "suppressed" with its current reasons.
 */
export async function listSuppressions(db: Queryable, workspaceId: string, q: { since?: string; limit?: number }) {
  const limit = Math.min(q.limit ?? 1000, 5000);
  const result = await db.query<{
    contact_id: string;
    email: string | null;
    phone_e164: string | null;
    reasons: string[] | null;
    external_ids: { source: string; externalId: string }[] | null;
    changed_at: Date;
  }>(
    `with blocked as (
       select ch.contact_id,
              case when ch.channel = 'email' and ch.status = 'unsubscribed' then 'email_unsubscribed'
                   when ch.channel = 'email' then 'email_bounced'
                   when ch.channel = 'phone' then 'phone_do_not_contact'
                   else 'whatsapp_' || ch.status end as reason,
              ch.updated_at as changed_at
         from crm.contact_channels ch where ${BLOCKED_CHANNEL}
       union all
       select id, 'do_not_contact', dnc_at from crm.contacts where status = 'do_not_contact'
     ),
     lifted as (
       select contact_id, created_at as changed_at from crm.dnc_events where action = 'reactivated'
       union all
       select ch.contact_id, ch.updated_at from crm.contact_channels ch where not ${BLOCKED_CHANNEL}
     ),
     changes as (
       select contact_id, reason, changed_at from blocked
       union all
       select contact_id, null, changed_at from lifted where $2::timestamptz is not null
     )
     select c.id as contact_id, c.email, c.phone_e164,
            array_agg(distinct x.reason order by x.reason) filter (where x.reason is not null) as reasons,
            max(x.changed_at) as changed_at,
            (select json_agg(json_build_object('source', r.source, 'externalId', r.external_id) order by r.source)
               from crm.external_refs r where r.contact_id = c.id) as external_ids
       from changes x
       join crm.contacts c on c.id = x.contact_id and c.workspace_id = $1 and c.status <> 'merged'
      group by c.id
     having $2::timestamptz is null or max(x.changed_at) > $2::timestamptz
      order by changed_at, c.id
      limit $3`,
    [workspaceId, q.since ?? null, limit],
  );
  const data = result.rows.map((r) => {
    const changedAt = r.changed_at.toISOString();
    const base = { contactId: r.contact_id, email: r.email, phone: r.phone_e164, externalIds: r.external_ids ?? [] };
    return r.reasons?.length
      ? { ...base, status: "suppressed" as const, reasons: r.reasons, changedAt }
      : { ...base, status: "lifted" as const, reasons: [], changedAt, liftedAt: changedAt };
  });
  return { data, nextSince: data.at(-1)?.changedAt ?? q.since ?? null };
}
