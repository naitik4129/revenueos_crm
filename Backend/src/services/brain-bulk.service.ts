/**
 * Set-based brain batches: the same rules as the per-item handlers in brain.service.ts (which
 * stay the fallback, and the path for handovers), in a handful of statements per batch instead
 * of several per item. Each handler:
 *  1. reads everything it needs to decide in a few queries (matched rows locked FOR UPDATE),
 *  2. decides every item in order in code, exactly as the items would run one after another
 *     (a later item sees what an earlier one created or filled),
 *  3. writes the result in a few statements (new ids made in code).
 * Runs inside runBatch's transaction, under its per-workspace lock. A decided problem (an unknown
 * contact) is that item's error; anything unexpected throws and runBatch falls back.
 */
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { Queryable } from "../dto.js";
import { AppError, NotFoundError, ValidationError } from "../errors.js";
import { EMAIL_STATUSES, LIFECYCLE_STAGES, type EmailStatus, type LifecycleStage } from "../domain/enums.js";
import { normalizeDomain } from "./companies.service.js";
import { markDnc } from "./contacts.service.js";
import { BRAIN_ACTOR, insertTimelineRows, type TimelineInsertRow } from "./timeline.service.js";
import { cleanContact, type BulkHandler, type callItem, type companyItem, type ContactData, type contactItem, type emailEventItem, type ItemOutcome } from "./brain.service.js";

type Outcome = ItemOutcome | { error: AppError };
const json = (rows: object[]) => JSON.stringify(rows);
const refKey = (source: string, externalId: string) => `${source}\u0000${externalId}`;
const uniq = <V>(values: (V | null | undefined)[]) => [...new Set(values.filter((v): v is V => v !== null && v !== undefined))];
/** First non-empty value: brain data only fills what is still empty. */
const fill = <V>(current: V | null, incoming: V | null | undefined) => current ?? incoming ?? null;

// --- Shared writes ------------------------------------------------------------------------------

type TimelineRow = TimelineInsertRow;
const insertTimeline = (db: Queryable, workspaceId: string, rows: TimelineRow[]) => insertTimelineRows(db, workspaceId, BRAIN_ACTOR, rows);

async function insertRefs(db: Queryable, workspaceId: string, kind: "company" | "contact", rows: { id: string; source: string; external_id: string }[]) {
  if (!rows.length) return;
  await db.query(
    `insert into crm_external_refs (workspace_id, ${kind}_id, source, external_id)
     select $1, x.id, x.source, x.external_id from jsonb_to_recordset($2::jsonb) as x(id uuid, source text, external_id text)
     on conflict do nothing`,
    [workspaceId, json(rows)],
  );
}

/** Lifecycle moves forward only; each move is a timeline entry, like advanceLifecycle. */
class Lifecycle {
  private moves: { contact_id: string; stage: LifecycleStage }[] = [];
  constructor(private stages: Map<string, LifecycleStage>) {}

  advance(contactId: string, stage: LifecycleStage) {
    const current = this.stages.get(contactId) ?? "prospect";
    if (LIFECYCLE_STAGES.indexOf(stage) <= LIFECYCLE_STAGES.indexOf(current)) return;
    this.stages.set(contactId, stage);
    this.moves.push({ contact_id: contactId, stage });
  }

  async write(db: Queryable, workspaceId: string) {
    if (!this.moves.length) return;
    const final = [...new Map(this.moves.map((m) => [m.contact_id, m])).values()];
    await db.query(
      `update crm_contacts c set lifecycle_stage = x.stage::crm_lifecycle_stage, lifecycle_changed_at = now()
         from jsonb_to_recordset($1::jsonb) as x(contact_id uuid, stage text)
        where c.id = x.contact_id and c.lifecycle_stage < x.stage::crm_lifecycle_stage`,
      [json(final)],
    );
    await insertTimeline(db, workspaceId, this.moves.map((m) => ({ contact_id: m.contact_id, event_kind: "lifecycle", title: `Lifecycle: ${m.stage}` })));
  }
}

// --- Contacts ---------------------------------------------------------------------------------

interface ContactRowState {
  id: string;
  company_id: string | null;
  first_name: string;
  last_name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  phone_e164: string | null;
  linkedin_url: string | null;
  country: string | null;
  location: string | null;
  lifecycle_stage: LifecycleStage;
}
const CONTACT_FIELDS = "id, company_id, first_name, last_name, job_title, email, phone, phone_e164, linkedin_url, country, location, lifecycle_stage";

/**
 * upsertContact for a whole batch: external ref -> email -> E.164 phone, then merged contacts to
 * their target; fills only empty fields (email/phone only when no other contact holds them);
 * creates the rest as brain prospects. Returns one result per input plus every contact's stage.
 */
async function resolveContacts(db: Queryable, workspaceId: string, inputs: ContactData[]) {
  const cleaned = inputs.map(cleanContact);
  const refs = uniq(inputs.map((c) => (c.source && c.externalId ? refKey(c.source, c.externalId) : null))).map((k) => k.split("\u0000") as [string, string]);
  const companyRefs = uniq(inputs.map((c) => (c.companyRef ? refKey(c.companyRef.source, c.companyRef.externalId) : null))).map((k) => k.split("\u0000") as [string, string]);
  const found = await db.query<{ kind: string; a: string; b: string | null; id: string }>(
    `select 'ref' as kind, r.source as a, r.external_id as b, r.contact_id as id
       from crm_external_refs r join unnest($2::text[], $3::text[]) p(s, e) on r.source = p.s and r.external_id = p.e
      where r.workspace_id = $1 and r.contact_id is not null
     union all
     select 'company', r.source, r.external_id, r.company_id
       from crm_external_refs r join unnest($4::text[], $5::text[]) p(s, e) on r.source = p.s and r.external_id = p.e
      where r.workspace_id = $1 and r.company_id is not null
     union all
     select 'email', lower(c.email), null, c.id from crm_contacts c where c.workspace_id = $1 and lower(c.email) = any($6::text[])
     union all
     select 'phone', c.phone_e164, null, c.id from crm_contacts c where c.workspace_id = $1 and c.phone_e164 = any($7::text[])`,
    [workspaceId, refs.map((r) => r[0]), refs.map((r) => r[1]), companyRefs.map((r) => r[0]), companyRefs.map((r) => r[1]), uniq(cleaned.map((c) => c.email)), uniq(cleaned.map((c) => c.phoneE164))],
  );
  const byRef = new Map<string, string>();
  const byEmail = new Map<string, string>();
  const byPhone = new Map<string, string>();
  const companies = new Map<string, string>();
  const lookup: Record<string, Map<string, string>> = { ref: byRef, email: byEmail, phone: byPhone, company: companies };
  for (const f of found.rows) lookup[f.kind]!.set(f.b === null ? f.a : refKey(f.a, f.b), f.id);

  // Merged contacts resolve to their target (up to 10 hops, like findContact); targets are locked.
  const starts = uniq([...byRef.values(), ...byEmail.values(), ...byPhone.values()]);
  const targetOf = new Map<string, string>();
  const rows = new Map<string, ContactRowState>();
  if (starts.length) {
    const chains = await db.query<ContactRowState & { start: string }>(
      `with recursive chain (start, id, next, hops) as (
         select c.id, c.id, c.merged_into_contact_id, 0 from crm_contacts c where c.id = any($1::uuid[])
         union all
         select ch.start, c.id, c.merged_into_contact_id, ch.hops + 1
           from chain ch join crm_contacts c on c.id = ch.next
          where ch.hops < 10
       ),
       target as (select distinct on (start) start, id from chain order by start, hops desc)
       select t.start, ${CONTACT_FIELDS.split(", ").map((f) => `c.${f}`).join(", ")}
         from target t join crm_contacts c on c.id = t.id
        order by c.id
          for update of c`,
      [starts],
    );
    for (const r of chains.rows) {
      targetOf.set(r.start, r.id);
      rows.set(r.id, r);
    }
  }

  const stages = new Map<string, LifecycleStage>();
  for (const r of rows.values()) stages.set(r.id, r.lifecycle_stage);
  const fromDb = new Set(rows.keys());
  const created: ContactRowState[] = [];
  const patched = new Set<string>();
  const newRefs: { id: string; source: string; external_id: string }[] = [];
  const results = inputs.map((c, i): { id: string; status: "created" | "updated" } | { error: AppError } => {
    const clean = cleaned[i]!;
    const ref = c.source && c.externalId ? refKey(c.source, c.externalId) : null;
    const matched = (ref && byRef.get(ref)) || (clean.email && byEmail.get(clean.email)) || (clean.phoneE164 && byPhone.get(clean.phoneE164)) || null;
    const matchedId = matched ? (targetOf.get(matched) ?? matched) : null;
    const companyId = c.companyRef ? (companies.get(refKey(c.companyRef.source, c.companyRef.externalId)) ?? null) : null;
    let status: "created" | "updated" = "updated";
    let id: string;

    const row = matchedId ? rows.get(matchedId) : undefined;
    if (matchedId && !row) throw new Error(`Matched contact ${matchedId} could not be read.`);
    if (row) {
      id = row.id;
      if (row.first_name === "Unknown" && clean.firstName) row.first_name = clean.firstName;
      if (row.last_name === "") row.last_name = clean.lastName ?? "";
      row.job_title = fill(row.job_title, clean.jobTitle);
      if (!row.email && clean.email && !byEmail.has(clean.email)) {
        row.email = clean.email;
        byEmail.set(clean.email, row.id);
      }
      if (!row.phone && clean.phoneE164 && !byPhone.has(clean.phoneE164)) {
        row.phone = clean.phone;
        row.phone_e164 = clean.phoneE164;
        byPhone.set(clean.phoneE164, row.id);
      }
      row.linkedin_url = fill(row.linkedin_url, clean.linkedinUrl);
      row.country = fill(row.country, clean.country);
      row.location = fill(row.location, clean.location);
      row.company_id = fill(row.company_id, companyId);
      if (fromDb.has(row.id)) patched.add(row.id);
    } else {
      if (!clean.email && !clean.phoneE164 && !clean.linkedinUrl) {
        return {
          error: c.externalId
            ? new NotFoundError("Contact (send it to /brain/v1/contacts first, or include an email, phone or LinkedIn URL)")
            : new ValidationError("A new contact needs a valid email, phone or LinkedIn URL."),
        };
      }
      const fresh: ContactRowState = {
        id: randomUUID(),
        company_id: companyId,
        first_name: clean.firstName ?? "Unknown",
        last_name: clean.lastName ?? "",
        job_title: clean.jobTitle,
        email: clean.email,
        phone: clean.phone,
        phone_e164: clean.phoneE164,
        linkedin_url: clean.linkedinUrl,
        country: clean.country,
        location: clean.location,
        lifecycle_stage: "prospect",
      };
      id = fresh.id;
      created.push(fresh);
      rows.set(id, fresh);
      stages.set(id, "prospect");
      if (clean.email) byEmail.set(clean.email, id);
      if (clean.phoneE164) byPhone.set(clean.phoneE164, id);
      status = "created";
    }
    if (ref && c.source && c.externalId) {
      newRefs.push({ id, source: c.source, external_id: c.externalId });
      if (!byRef.has(ref)) byRef.set(ref, id);
    }
    return { id, status };
  });

  if (created.length) {
    await db.query(
      `insert into crm_contacts (id, workspace_id, company_id, first_name, last_name, job_title, email, phone, phone_e164, linkedin_url, country, location, source)
       select x.id, $1, x.company_id, x.first_name, x.last_name, x.job_title, x.email, x.phone, x.phone_e164, x.linkedin_url, x.country, x.location, 'brain'
         from jsonb_to_recordset($2::jsonb) as x(id uuid, company_id uuid, first_name text, last_name text, job_title text, email text, phone text,
                                                 phone_e164 text, linkedin_url text, country text, location text)`,
      [workspaceId, json(created)],
    );
  }
  if (patched.size) {
    await db.query(
      `update crm_contacts t set first_name = x.first_name, last_name = x.last_name, job_title = x.job_title, email = x.email, phone = x.phone,
              phone_e164 = x.phone_e164, linkedin_url = x.linkedin_url, country = x.country, location = x.location, company_id = x.company_id
         from jsonb_to_recordset($1::jsonb) as x(id uuid, company_id uuid, first_name text, last_name text, job_title text, email text, phone text,
                                                 phone_e164 text, linkedin_url text, country text, location text)
        where t.id = x.id`,
      [json([...patched].map((id) => rows.get(id)!))],
    );
  }
  await insertRefs(db, workspaceId, "contact", newRefs);
  await insertTimeline(db, workspaceId, created.map((r) => ({ contact_id: r.id, event_kind: "system", title: "Contact Created", detail: "From the RevenueOS brain" })));
  return { results, stages };
}

export const bulkContacts: BulkHandler<z.infer<typeof contactItem>> = async (db, workspaceId, items) => (await resolveContacts(db, workspaceId, items)).results;

// --- Companies --------------------------------------------------------------------------------

interface CompanyRowState {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  location: string | null;
  city: string | null;
  country: string | null;
  headcount: number | null;
  phone: string | null;
  linkedin_url: string | null;
}
const COMPANY_FILLS = ["website", "industry", "location", "city", "country", "headcount", "phone", "linkedin_url"] as const;

/** upsertCompany for a whole batch: external ref, then domain; fills only empty fields. */
export const bulkCompanies: BulkHandler<z.infer<typeof companyItem>> = async (db, workspaceId, items) => {
  const domains = items.map((item) => normalizeDomain(item.domain ?? item.website));
  const refs = uniq(items.map((i) => refKey(i.source, i.externalId))).map((k) => k.split("\u0000") as [string, string]);
  const found = await db.query<{ kind: string; a: string; b: string | null; id: string }>(
    `select 'ref' as kind, r.source as a, r.external_id as b, r.company_id as id
       from crm_external_refs r join unnest($2::text[], $3::text[]) p(s, e) on r.source = p.s and r.external_id = p.e
      where r.workspace_id = $1 and r.company_id is not null
     union all
     select 'domain', lower(co.domain), null, co.id from crm_companies co where co.workspace_id = $1 and lower(co.domain) = any($4::text[])`,
    [workspaceId, refs.map((r) => r[0]), refs.map((r) => r[1]), uniq(domains)],
  );
  const byRef = new Map<string, string>();
  const byDomain = new Map<string, string>();
  for (const f of found.rows) (f.kind === "ref" ? byRef : byDomain).set(f.b === null ? f.a : refKey(f.a, f.b), f.id);

  const rows = new Map<string, CompanyRowState>();
  const matched = uniq([...byRef.values(), ...byDomain.values()]);
  if (matched.length) {
    const locked = await db.query<CompanyRowState>(
      `select id, name, domain, website, industry, location, city, country, headcount, phone, linkedin_url
         from crm_companies where id = any($1::uuid[]) order by id for update`,
      [matched],
    );
    for (const r of locked.rows) rows.set(r.id, r);
  }

  const fromDb = new Set(rows.keys());
  const created: CompanyRowState[] = [];
  const patched = new Set<string>();
  const newRefs: { id: string; source: string; external_id: string }[] = [];
  const outcomes = items.map((item, i): Outcome => {
    const domain = domains[i] ?? null;
    const ref = refKey(item.source, item.externalId);
    const matchedId = byRef.get(ref) ?? (domain ? byDomain.get(domain) : undefined) ?? null;
    let id: string;
    const incoming = {
      website: item.website || null,
      industry: item.industry || null,
      location: item.location || null,
      city: item.city || null,
      country: item.country || null,
      headcount: item.headcount ?? null,
      phone: item.phone || null,
      linkedin_url: item.linkedinUrl || null,
    };
    let status: "created" | "updated" = "updated";
    const row = matchedId ? rows.get(matchedId) : undefined;
    if (matchedId && !row) throw new Error(`Matched company ${matchedId} could not be read.`);
    if (row) {
      id = row.id;
      if (!row.domain && domain && !byDomain.has(domain)) {
        row.domain = domain;
        byDomain.set(domain, row.id);
      }
      for (const f of COMPANY_FILLS) (row as unknown as Record<string, unknown>)[f] = fill(row[f], incoming[f]);
      if (fromDb.has(row.id)) patched.add(row.id);
    } else {
      const fresh: CompanyRowState = { id: randomUUID(), name: item.name, domain, ...incoming };
      id = fresh.id;
      created.push(fresh);
      rows.set(id, fresh);
      if (domain) byDomain.set(domain, id);
      status = "created";
    }
    newRefs.push({ id, source: item.source, external_id: item.externalId });
    if (!byRef.has(ref)) byRef.set(ref, id);
    return { status, id };
  });

  const columns = `id uuid, name text, domain text, website text, industry text, location text, city text, country text, headcount integer, phone text, linkedin_url text`;
  if (created.length) {
    await db.query(
      `insert into crm_companies (id, workspace_id, name, domain, website, industry, location, city, country, headcount, phone, linkedin_url, source)
       select x.id, $1, x.name, x.domain, x.website, x.industry, x.location, x.city, x.country, x.headcount, x.phone, x.linkedin_url, 'brain'
         from jsonb_to_recordset($2::jsonb) as x(${columns})`,
      [workspaceId, json(created)],
    );
  }
  if (patched.size) {
    await db.query(
      `update crm_companies t set domain = x.domain, website = x.website, industry = x.industry, location = x.location, city = x.city,
              country = x.country, headcount = x.headcount, phone = x.phone, linkedin_url = x.linkedin_url
         from jsonb_to_recordset($1::jsonb) as x(${columns})
        where t.id = x.id`,
      [json([...patched].map((id) => rows.get(id)!))],
    );
  }
  await insertRefs(db, workspaceId, "company", newRefs);
  await insertTimeline(db, workspaceId, created.map((r) => ({ company_id: r.id, event_kind: "system", title: "Company Created", detail: "From the RevenueOS brain" })));
  return outcomes;
};

// --- AI calls ---------------------------------------------------------------------------------

interface CallState {
  id: string;
  contact_id: string;
  external_id: string;
  connected: boolean;
  direction: string | null;
  started_at: string | null;
  duration_seconds: number | null;
  ai_outcome: string | null;
  summary: string | null;
  sentiment: string | null;
  transcript: string | null;
  recording_url: string | null;
}

/** upsertCall for a whole batch: a re-send updates the same call (newer values win, empty ones keep the old). */
export const bulkCalls: BulkHandler<z.infer<typeof callItem>> = async (db, workspaceId, items) => {
  const contacts = await resolveContacts(db, workspaceId, items.map((i) => i.contact));
  const existing = await db.query<{ external_id: string; id: string }>(
    `select external_id, id from crm_calls where workspace_id = $1 and external_source = 'quickhowl' and external_id = any($2::text[])`,
    [workspaceId, uniq(items.map((i) => i.externalId))],
  );
  const known = new Map(existing.rows.map((r) => [r.external_id, r.id]));

  const lifecycle = new Lifecycle(contacts.stages);
  const calls = new Map<string, CallState & { isNew: boolean }>();
  const timeline: TimelineRow[] = [];
  const dnc: string[] = [];
  const outcomes = items.map((item, i): Outcome => {
    const contact = contacts.results[i]!;
    if ("error" in contact) return contact;
    const incoming = {
      connected: item.connected,
      direction: item.direction ?? null,
      started_at: item.startedAt ?? null,
      duration_seconds: item.durationSeconds ?? null,
      ai_outcome: item.outcome || null,
      summary: item.summary || null,
      sentiment: item.sentiment || null,
      transcript: item.transcript ?? null,
      recording_url: item.recordingUrl || null,
    };
    let call = calls.get(item.externalId);
    let status: "created" | "updated" = "updated";
    if (!call) {
      const id = known.get(item.externalId);
      call = { id: id ?? randomUUID(), contact_id: contact.id, external_id: item.externalId, isNew: !id, ...incoming };
      calls.set(item.externalId, call);
      if (call.isNew) {
        status = "created";
        timeline.push({
          contact_id: contact.id,
          event_kind: "call",
          title: item.connected ? "AI Call (connected)" : "AI Call (not connected)",
          detail: item.summary || item.outcome || null,
          related_call_id: call.id,
          occurred_at: item.startedAt ?? null,
        });
      }
    } else {
      // A second item for the same call in this batch: like the re-send update.
      call.connected = incoming.connected;
      for (const f of ["direction", "started_at", "duration_seconds", "ai_outcome", "summary", "sentiment", "transcript", "recording_url"] as const) {
        (call as unknown as Record<string, unknown>)[f] = incoming[f] ?? call[f];
      }
    }
    lifecycle.advance(contact.id, item.connected ? "engaged" : "contacted");
    if (item.dnc) dnc.push(contact.id);
    return { status, id: call.id };
  });

  const all = [...calls.values()];
  const columns = `id uuid, contact_id uuid, external_id text, connected boolean, direction text, started_at timestamptz, duration_seconds integer,
                   ai_outcome text, summary text, sentiment text, transcript text, recording_url text`;
  const fresh = all.filter((c) => c.isNew);
  if (fresh.length) {
    await db.query(
      `insert into crm_calls (id, workspace_id, contact_id, source, connected, direction, occurred_at, duration_seconds, ai_outcome,
                              summary, sentiment, transcript, recording_url, external_source, external_id)
       select x.id, $1, x.contact_id, 'ai', x.connected, x.direction, coalesce(x.started_at, now()), x.duration_seconds, x.ai_outcome,
              x.summary, x.sentiment, x.transcript, x.recording_url, 'quickhowl', x.external_id
         from jsonb_to_recordset($2::jsonb) as x(${columns})`,
      [workspaceId, json(fresh)],
    );
  }
  const resent = all.filter((c) => !c.isNew);
  if (resent.length) {
    await db.query(
      `update crm_calls t set connected = x.connected, direction = coalesce(x.direction, t.direction), occurred_at = coalesce(x.started_at, t.occurred_at),
              duration_seconds = coalesce(x.duration_seconds, t.duration_seconds), ai_outcome = coalesce(x.ai_outcome, t.ai_outcome),
              summary = coalesce(x.summary, t.summary), sentiment = coalesce(x.sentiment, t.sentiment),
              transcript = coalesce(x.transcript, t.transcript), recording_url = coalesce(x.recording_url, t.recording_url)
         from jsonb_to_recordset($1::jsonb) as x(${columns})
        where t.id = x.id`,
      [json(resent)],
    );
  }
  await insertTimeline(db, workspaceId, timeline);
  await lifecycle.write(db, workspaceId);
  // Rare and many-sided (status, tasks, timeline): the same code as a single call.
  for (const contactId of dnc) await markDnc(db, BRAIN_ACTOR, workspaceId, contactId, { reason: "Asked not to be contacted (AI call)" });
  return outcomes;
};

// --- Email events -----------------------------------------------------------------------------

const AT = Object.fromEntries(EMAIL_STATUSES.map((s) => [s, `${s}_at`])) as Record<EmailStatus, string>;
const higher = (a: EmailStatus, b: EmailStatus) => (EMAIL_STATUSES.indexOf(b) > EMAIL_STATUSES.indexOf(a) ? b : a);
const EVENT_TITLES: Partial<Record<EmailStatus, string>> = { replied: "Replied to Campaign Email", bounced: "Campaign Email Bounced", unsubscribed: "Unsubscribed" };

interface EmailState {
  id: string;
  contact_id: string;
  external_id: string;
  campaign_ref: string | null;
  campaign_name: string | null;
  step: number | null;
  subject: string | null;
  status: EmailStatus;
  reply_text: string | null;
  at: Partial<Record<EmailStatus, string>>;
}

/**
 * upsertEmailEvent for a whole batch. One row per message; its status only moves up, each event
 * time is kept from the first time it arrived, and the email channel never goes from
 * unsubscribed back to bounced. Several events for one message in a batch are folded in order.
 */
export const bulkEmailEvents: BulkHandler<z.infer<typeof emailEventItem>> = async (db, workspaceId, items) => {
  const contacts = await resolveContacts(db, workspaceId, items.map((i) => i.contact));
  const existing = await db.query<{ external_id: string; id: string; seen: EmailStatus[] }>(
    `select external_id, id,
            array_remove(array[${EMAIL_STATUSES.map((s) => `case when ${AT[s]} is not null then '${s}' end`).join(", ")}], null) as seen
       from crm_email_activities where workspace_id = $1 and external_source = 'email_tool' and external_id = any($2::text[])`,
    [workspaceId, uniq(items.map((i) => i.messageId))],
  );
  const seen = new Map(existing.rows.map((r) => [r.external_id, { id: r.id, events: new Set(r.seen) }]));

  const lifecycle = new Lifecycle(contacts.stages);
  const messages = new Map<string, EmailState>();
  const channels = new Map<string, { contact_id: string; status: "unsubscribed" | "permanent_bounce"; reason: string }>();
  const timeline: TimelineRow[] = [];
  const outcomes = items.map((item, i): Outcome => {
    const contact = contacts.results[i]!;
    if ("error" in contact) return contact;
    const before = seen.get(item.messageId);
    const firstTime = !before?.events.has(item.event);
    const id = before?.id ?? messages.get(item.messageId)?.id ?? randomUUID();
    seen.set(item.messageId, { id, events: new Set([...(before?.events ?? []), item.event]) });

    // What this batch writes: the existing row (if any) merges with it in SQL by the same rules.
    const msg = messages.get(item.messageId);
    const replyText = item.event === "replied" ? (item.replyText ?? null) : null;
    if (!msg) {
      messages.set(item.messageId, {
        id,
        contact_id: contact.id,
        external_id: item.messageId,
        campaign_ref: item.campaignRef || null,
        campaign_name: item.campaignName || null,
        step: item.step ?? null,
        subject: item.subject || null,
        status: item.event,
        reply_text: replyText,
        at: { [item.event]: item.occurredAt },
      });
    } else {
      msg.status = higher(msg.status, item.event);
      msg.at[item.event] ??= item.occurredAt;
      msg.reply_text = fill(msg.reply_text, replyText);
      msg.campaign_ref = fill(msg.campaign_ref, item.campaignRef || null);
      msg.campaign_name = fill(msg.campaign_name, item.campaignName || null);
      msg.step = fill(msg.step, item.step);
      msg.subject = fill(msg.subject, item.subject || null);
    }

    lifecycle.advance(contact.id, item.event === "replied" ? "engaged" : "contacted");
    if (item.event === "unsubscribed") channels.set(contact.id, { contact_id: contact.id, status: "unsubscribed", reason: "Unsubscribed from a campaign email" });
    if (item.event === "bounced" && channels.get(contact.id)?.status !== "unsubscribed") {
      channels.set(contact.id, { contact_id: contact.id, status: "permanent_bounce", reason: "Campaign email bounced" });
    }
    const title = EVENT_TITLES[item.event];
    if (firstTime && title) {
      timeline.push({
        contact_id: contact.id,
        event_kind: "email",
        title,
        detail: item.event === "replied" ? item.replyText || item.subject || null : item.campaignName || item.subject || null,
        occurred_at: item.occurredAt,
      });
    }
    return { status: before ? "updated" : "created", id };
  });

  if (messages.size) {
    const rows = [...messages.values()].map(({ at, ...m }) => ({ ...m, ...Object.fromEntries(EMAIL_STATUSES.map((s) => [AT[s], at[s] ?? null])) }));
    await db.query(
      `insert into crm_email_activities (id, workspace_id, contact_id, external_source, external_id, campaign_ref, campaign_name, step, subject, status, reply_text,
                                         ${EMAIL_STATUSES.map((s) => AT[s]).join(", ")})
       select x.id, $1, x.contact_id, 'email_tool', x.external_id, x.campaign_ref, x.campaign_name, x.step, x.subject, x.status::crm_email_status, x.reply_text,
              ${EMAIL_STATUSES.map((s) => `x.${AT[s]}`).join(", ")}
         from jsonb_to_recordset($2::jsonb) as x(id uuid, contact_id uuid, external_id text, campaign_ref text, campaign_name text, step integer, subject text,
                                                 status text, reply_text text, ${EMAIL_STATUSES.map((s) => `${AT[s]} timestamptz`).join(", ")})
       on conflict (workspace_id, external_source, external_id) where external_id is not null
       do update set status = greatest(crm_email_activities.status, excluded.status),
                     ${EMAIL_STATUSES.map((s) => `${AT[s]} = coalesce(crm_email_activities.${AT[s]}, excluded.${AT[s]})`).join(",\n                     ")},
                     reply_text = coalesce(crm_email_activities.reply_text, excluded.reply_text),
                     campaign_ref = coalesce(crm_email_activities.campaign_ref, excluded.campaign_ref),
                     campaign_name = coalesce(crm_email_activities.campaign_name, excluded.campaign_name),
                     step = coalesce(crm_email_activities.step, excluded.step),
                     subject = coalesce(crm_email_activities.subject, excluded.subject)`,
      [workspaceId, json(rows)],
    );
  }
  await lifecycle.write(db, workspaceId);
  if (channels.size) {
    await db.query(
      `insert into crm_contact_channels (contact_id, channel, status, reason)
       select x.contact_id, 'email', x.status, x.reason from jsonb_to_recordset($1::jsonb) as x(contact_id uuid, status text, reason text)
       on conflict (contact_id, channel) do update set status = excluded.status, reason = excluded.reason
         where crm_contact_channels.status <> 'unsubscribed'`,
      [json([...channels.values()])],
    );
  }
  await insertTimeline(db, workspaceId, timeline);
  return outcomes;
};
