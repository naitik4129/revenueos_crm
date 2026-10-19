import type { Actor } from "../authMiddleware.js";
import { orderBySql, type Queryable } from "../dto.js";
import { ConflictError, DoNotContactError, ForbiddenError, isUniqueViolation, NotFoundError, ValidationError } from "../errors.js";
import {
  CONTACT_CHANNEL_STATUS,
  LEAD_SOURCES,
  type ContactChannel,
  type ContactStatus,
  type LeadSource,
  type LifecycleStage,
} from "../domain/enums.js";
import { lifecycleIndex } from "../domain/pipeline.js";
import { normalizeEmail } from "../domain/email.js";
import { normalizePhoneE164 } from "../domain/phone.js";
import { userNameSql } from "./profiles.service.js";
import { actorEvent, addTimelineEvent, toEventActor, type EventActor } from "./timeline.service.js";
import { findOrCreateCompany, writeDeletedAudit } from "./companies.service.js";
import { createDeal } from "./deals.service.js";

export interface ContactRow {
  id: string;
  workspace_id: string;
  company_id: string | null;
  company_name: string | null;
  first_name: string;
  last_name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  phone_e164: string | null;
  linkedin_url: string | null;
  country: string | null;
  location: string | null;
  owner_id: string | null;
  owner_name: string | null;
  source: LeadSource;
  status: ContactStatus;
  lifecycle_stage: LifecycleStage;
  lifecycle_changed_at: Date;
  dnc_reason: string | null;
  dnc_by_name: string | null;
  dnc_at: Date | null;
  merged_into_contact_id: string | null;
  open_deal_id: string | null;
  last_activity_at: Date;
  created_at: Date;
  updated_at: Date;
}

const CONTACT_SELECT = `
  select c.*, co.name as company_name, ${userNameSql("c.owner_id")} as owner_name,
         (select d.id from crm.deals d where d.contact_id = c.id and d.outcome = 'open') as open_deal_id
    from crm.contacts c
    left join crm.companies co on co.id = c.company_id`;

export function contactToDto(row: ContactRow) {
  return {
    id: row.id,
    companyId: row.company_id ?? undefined,
    companyName: row.company_name ?? undefined,
    firstName: row.first_name,
    lastName: row.last_name,
    jobTitle: row.job_title ?? undefined,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    phoneE164: row.phone_e164 ?? undefined,
    linkedinUrl: row.linkedin_url ?? undefined,
    country: row.country ?? undefined,
    location: row.location ?? undefined,
    ownerId: row.owner_id ?? undefined,
    ownerName: row.owner_name ?? undefined,
    source: row.source,
    status: row.status,
    doNotContact: row.status === "do_not_contact",
    dncReason: row.dnc_reason ?? undefined,
    dncBy: row.dnc_by_name ?? undefined,
    dncAt: row.dnc_at?.toISOString(),
    lifecycleStage: row.lifecycle_stage,
    lifecycleChangedAt: row.lifecycle_changed_at.toISOString(),
    mergedIntoContactId: row.merged_into_contact_id ?? undefined,
    openDealId: row.open_deal_id ?? undefined,
    lastActivityAt: row.last_activity_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function getContactOr404(db: Queryable, workspaceId: string, id: string): Promise<ContactRow> {
  const result = await db.query<ContactRow>(`${CONTACT_SELECT} where c.id = $1 and c.workspace_id = $2`, [id, workspaceId]);
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Contact");
  return row;
}

// --- Validation --------------------------------------------------------------

export interface ContactFieldsInput {
  firstName: string;
  lastName?: string;
  jobTitle?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  country?: string;
  location?: string;
  source?: string;
}

export interface ValidatedContactFields {
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  phoneE164: string | null;
  linkedinUrl: string | null;
  country: string | null;
  location: string | null;
  source: LeadSource;
}

const PHONE_HELP = "Enter a valid phone number. Indian local numbers default to +91; international numbers must include their country code.";

/** One set of field rules for single create and CSV import, so the two never diverge. */
export function validateContactFields(input: ContactFieldsInput): ValidatedContactFields {
  const firstName = input.firstName.trim();
  if (!firstName) throw new ValidationError("First name is required.", { field: "firstName" });
  const linkedinUrl = input.linkedinUrl?.trim() || null;
  if (!input.email?.trim() && !input.phone?.trim() && !linkedinUrl) {
    throw new ValidationError("Provide at least an email, a phone number or a LinkedIn URL.", { field: "email" });
  }
  const emailRaw = input.email?.trim() || null;
  const email = emailRaw ? normalizeEmail(emailRaw) : null;
  if (emailRaw && !email) throw new ValidationError("Enter a valid email address.", { field: "email" });
  const phone = input.phone?.trim() || null;
  const phoneE164 = phone ? normalizePhoneE164(phone) : null;
  if (phone && !phoneE164) throw new ValidationError(PHONE_HELP, { field: "phone" });
  const source = input.source?.trim() || "other";
  if (!(LEAD_SOURCES as readonly string[]).includes(source)) {
    throw new ValidationError(`Unknown source "${source}" - must be one of: ${LEAD_SOURCES.join(", ")}.`, { field: "source" });
  }
  return {
    firstName,
    lastName: input.lastName?.trim() ?? "",
    jobTitle: input.jobTitle?.trim() || null,
    email,
    phone,
    phoneE164,
    linkedinUrl,
    country: input.country?.trim() || null,
    location: input.location?.trim() || null,
    source: source as LeadSource,
  };
}

function duplicateConflict(err: unknown): never {
  if (isUniqueViolation(err, "contacts_workspace_email_key")) {
    throw new ConflictError("A contact with this email already exists in this workspace.", { field: "email" });
  }
  if (isUniqueViolation(err, "contacts_workspace_phone_key")) {
    throw new ConflictError("A contact with this phone number already exists in this workspace.", { field: "phone" });
  }
  throw err;
}

async function assertCompanyInWorkspace(db: Queryable, workspaceId: string, companyId: string | null | undefined) {
  if (!companyId) return;
  const found = await db.query(`select 1 from crm.companies where id = $1 and workspace_id = $2`, [companyId, workspaceId]);
  if (!found.rows[0]) throw new NotFoundError("Company");
}

// --- Create / list / update / delete ------------------------------------------

export interface CreateContactInput extends ContactFieldsInput {
  companyId?: string | null;
  ownerId?: string | null;
  /** Also open a deal for the contact (makes it `qualified`). */
  createDeal?: boolean;
}

async function insertContact(
  db: Queryable,
  actor: Actor,
  workspaceId: string,
  fields: ValidatedContactFields,
  companyId: string | null,
  ownerId: string | null,
): Promise<string> {
  return db
    .query<{ id: string }>(
      `insert into crm.contacts
        (workspace_id, company_id, first_name, last_name, job_title, email, phone, phone_e164,
         linkedin_url, country, location, owner_id, source, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
      [
        workspaceId,
        companyId,
        fields.firstName,
        fields.lastName,
        fields.jobTitle,
        fields.email,
        fields.phone,
        fields.phoneE164,
        fields.linkedinUrl,
        fields.country,
        fields.location,
        ownerId,
        fields.source,
        actor.id,
      ],
    )
    .then((r) => r.rows[0]!.id, duplicateConflict);
}

const defaultOwner = (actor: Actor) => (actor.role === "salesperson" ? actor.id : null);

export async function createContact(db: Queryable, actor: Actor, workspaceId: string, input: CreateContactInput): Promise<ContactRow> {
  const fields = validateContactFields(input);
  await assertCompanyInWorkspace(db, workspaceId, input.companyId);
  const id = await insertContact(db, actor, workspaceId, fields, input.companyId ?? null, input.ownerId ?? defaultOwner(actor));
  await addTimelineEvent(db, { contactId: id, kind: "system", title: "Contact Created", detail: `Source: ${fields.source}`, ...actorEvent(actor) });
  if (input.createDeal) await createDeal(db, actor, workspaceId, { contactId: id });
  return getContactOr404(db, workspaceId, id);
}

/** Sortable columns of the contacts list (`sort` = key, or "-key" for descending). */
export const CONTACT_SORTS: Record<string, string[]> = {
  name: ["lower(c.first_name)", "lower(c.last_name)"],
  company: ["lower(co.name)"],
  lastActivity: ["c.last_activity_at"],
  created: ["c.created_at"],
};

export interface ListContactsFilters {
  sort?: string;
  search?: string;
  lifecycleStage?: LifecycleStage;
  status?: ContactStatus;
  ownerId?: string;
  companyId?: string;
  limit?: number;
  offset?: number;
}

/** Paginated. Merged contacts are hidden unless asked for with status = merged. */
export async function listContacts(db: Queryable, workspaceId: string, f: ListContactsFilters) {
  const params: unknown[] = [workspaceId];
  const where = [`c.workspace_id = $1`];
  where.push(f.status ? `c.status = $${params.push(f.status)}` : `c.status <> 'merged'`);
  if (f.lifecycleStage) where.push(`c.lifecycle_stage = $${params.push(f.lifecycleStage)}`);
  if (f.ownerId) where.push(f.ownerId === "none" ? `c.owner_id is null` : `c.owner_id = $${params.push(f.ownerId)}`);
  if (f.companyId) where.push(`c.company_id = $${params.push(f.companyId)}`);
  if (f.search) {
    const p = `$${params.push(`%${f.search}%`)}`;
    // Full name too, so "Ann Lee" finds Ann Lee.
    where.push(`(concat_ws(' ', c.first_name, c.last_name) ilike ${p} or c.email ilike ${p} or c.phone ilike ${p} or co.name ilike ${p})`);
  }
  const limit = Math.min(f.limit ?? 50, 500);
  const offset = f.offset ?? 0;
  const result = await db.query<ContactRow & { total: number }>(
    `${CONTACT_SELECT.replace("select c.*,", "select c.*, count(*) over()::int as total,")}
      where ${where.join(" and ")}
      ${orderBySql(f.sort, CONTACT_SORTS, "c.created_at desc", "c.id")}
      limit $${params.push(limit)} offset $${params.push(offset)}`,
    params,
  );
  return { data: result.rows.map(contactToDto), total: result.rows[0]?.total ?? 0, limit, offset };
}

export interface UpdateContactInput {
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  country?: string;
  location?: string;
  source?: string;
  companyId?: string | null;
  ownerId?: string | null;
}

/** Field edits only. Consent, lifecycle and merge go through their own functions. */
export async function updateContact(db: Queryable, actor: Actor, workspaceId: string, id: string, patch: UpdateContactInput) {
  const current = await getContactOr404(db, workspaceId, id);
  if (current.status === "merged") throw new ConflictError("This contact was merged into another contact.");

  // Re-validate the merged result with the create rules (keeps "needs email/phone/LinkedIn" etc.).
  const merged = validateContactFields({
    firstName: patch.firstName ?? current.first_name,
    lastName: patch.lastName ?? current.last_name,
    jobTitle: patch.jobTitle ?? current.job_title ?? undefined,
    email: patch.email ?? current.email ?? undefined,
    phone: patch.phone ?? current.phone ?? undefined,
    linkedinUrl: patch.linkedinUrl ?? current.linkedin_url ?? undefined,
    country: patch.country ?? current.country ?? undefined,
    location: patch.location ?? current.location ?? undefined,
    source: patch.source ?? current.source,
  });
  if (patch.companyId !== undefined) await assertCompanyInWorkspace(db, workspaceId, patch.companyId);

  await db
    .query(
      `update crm.contacts
          set first_name = $2, last_name = $3, job_title = $4, email = $5, phone = $6, phone_e164 = $7,
              linkedin_url = $8, country = $9, location = $10, source = $11,
              company_id = case when $12 then $13::uuid else company_id end,
              owner_id = case when $14 then $15::uuid else owner_id end,
              -- An owner change alone is not activity; any other field that really changes is.
              -- (Right-hand column names are the row's values before this update.)
              last_activity_at = case
                when (first_name, last_name, job_title, email, phone, linkedin_url, country, location, source, company_id)
                     is distinct from ($2, $3, $4, $5, $6, $8, $9, $10, $11, case when $12 then $13::uuid else company_id end)
                then now() else last_activity_at end
        where id = $1`,
      [
        id,
        merged.firstName,
        merged.lastName,
        merged.jobTitle,
        merged.email,
        merged.phone,
        merged.phoneE164,
        merged.linkedinUrl,
        merged.country,
        merged.location,
        merged.source,
        patch.companyId !== undefined,
        patch.companyId ?? null,
        patch.ownerId !== undefined,
        patch.ownerId ?? null,
      ],
    )
    .catch(duplicateConflict);

  if (patch.ownerId !== undefined && patch.ownerId !== current.owner_id) {
    const owner = await db.query<{ name: string | null }>(`select ${userNameSql("$1::uuid")} as name`, [patch.ownerId]);
    await addTimelineEvent(db, { contactId: id, kind: "system", title: "Contact Assigned", detail: `Owner: ${owner.rows[0]?.name ?? "Unassigned"}`, ...actorEvent(actor) });
  }
  return getContactOr404(db, workspaceId, id);
}

/** Permanent delete with an audit snapshot; deals, activity and timeline go with it. */
export async function deleteContact(db: Queryable, actor: Actor, workspaceId: string, id: string) {
  const contact = await getContactOr404(db, workspaceId, id);
  await writeDeletedAudit(db, actor, workspaceId, "contact", id, contactToDto(contact));
  await db.query(`delete from crm.contacts where id = $1`, [id]);
}

// --- Notes ------------------------------------------------------------------------

export async function addNote(db: Queryable, actor: Actor, workspaceId: string, contactId: string, input: { body: string; dealId?: string }) {
  const body = input.body.trim();
  if (!body) throw new ValidationError("Note body is required.");
  await getContactOr404(db, workspaceId, contactId);
  if (input.dealId) {
    const deal = await db.query(`select 1 from crm.deals where id = $1 and contact_id = $2`, [input.dealId, contactId]);
    if (!deal.rows[0]) throw new NotFoundError("Deal");
  }
  const note = await db.query<{ id: string; created_at: Date }>(
    `insert into crm.notes (workspace_id, contact_id, deal_id, author_id, body) values ($1,$2,$3,$4,$5) returning id, created_at`,
    [workspaceId, contactId, input.dealId ?? null, actor.id, body],
  );
  await db.query(`update crm.contacts set last_activity_at = now() where id = $1`, [contactId]);
  await addTimelineEvent(db, { contactId, dealId: input.dealId ?? null, kind: "note", title: "Note Added", detail: body, ...actorEvent(actor) });
  const row = note.rows[0]!;
  return { id: row.id, dealId: input.dealId, author: actor.fullName, body, at: row.created_at.toISOString() };
}

export async function listNotes(db: Queryable, workspaceId: string, contactId: string) {
  await getContactOr404(db, workspaceId, contactId);
  const result = await db.query<{ id: string; deal_id: string | null; author: string | null; body: string; created_at: Date }>(
    `select n.id, n.deal_id, ${userNameSql("n.author_id")} as author, n.body, n.created_at
       from crm.notes n where n.contact_id = $1 order by n.created_at desc`,
    [contactId],
  );
  return result.rows.map((r) => ({ id: r.id, dealId: r.deal_id ?? undefined, author: r.author ?? "", body: r.body, at: r.created_at.toISOString() }));
}

// --- Consent: DNC -------------------------------------------------------------------

/**
 * DNC: the 009 trigger writes dnc_events, stops automation on the contact's deals and cancels
 * their runs/actions; deals stay open. Open tasks (the contact's and its deals') are cancelled
 * here so no next action survives. actor: a user, or the brain for an AI-call DNC.
 */
export async function markDnc(db: Queryable, actor: Actor | EventActor, workspaceId: string, contactId: string, input: { reason: string }) {
  const reason = input.reason.trim();
  if (!reason) throw new ValidationError("A reason is required to mark Do Not Contact.");
  const current = await getContactOr404(db, workspaceId, contactId);
  if (current.status === "merged") throw new ConflictError("This contact was merged into another contact.");
  if (current.status === "do_not_contact") return current;

  await db.query(
    `update crm.contacts
        set status = 'do_not_contact', dnc_reason = $2, dnc_by = $3, dnc_by_name = $4, dnc_at = now(), last_activity_at = now()
      where id = $1`,
    [contactId, reason, "fullName" in actor ? actor.id : null, "fullName" in actor ? actor.fullName : actor.actorName],
  );
  await db.query(
    `update crm.tasks set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Contact marked Do Not Contact'
      where status = 'open' and (contact_id = $1 or deal_id in (select id from crm.deals where contact_id = $1))`,
    [contactId],
  );
  await addTimelineEvent(db, { contactId, kind: "system", title: "Do Not Contact", detail: reason, ...toEventActor(actor) });
  return getContactOr404(db, workspaceId, contactId);
}

/** Lifting DNC is deliberate and reasoned; automation is not resumed (deals stay stopped until a rep restarts them). */
export async function reactivateFromDnc(db: Queryable, actor: Actor, workspaceId: string, contactId: string, reason: string) {
  if (!reason.trim()) throw new ValidationError("A reason is required to reactivate a Do Not Contact contact.");
  const current = await getContactOr404(db, workspaceId, contactId);
  if (current.status !== "do_not_contact") throw new ConflictError("Contact is not currently Do Not Contact.");

  await db.query(
    `update crm.contacts set status = 'active', dnc_reason = $2, dnc_by = $3, dnc_by_name = $4, last_activity_at = now() where id = $1`,
    [contactId, reason.trim(), actor.id, actor.fullName],
  );
  await addTimelineEvent(db, { contactId, kind: "system", title: "Do Not Contact Lifted", detail: reason.trim(), ...actorEvent(actor) });
  return getContactOr404(db, workspaceId, contactId);
}

// --- Contactability -------------------------------------------------------------------

export interface SetContactabilityInput {
  channel: ContactChannel;
  status: string;
  reason?: string;
}

/** Per-channel status: a bad phone number must not invalidate the whole contact. */
export async function setContactability(db: Queryable, actor: Actor, workspaceId: string, contactId: string, input: SetContactabilityInput) {
  const allowed = CONTACT_CHANNEL_STATUS[input.channel];
  if (!allowed.includes(input.status)) {
    throw new ValidationError(`"${input.status}" is not a valid status for channel "${input.channel}".`, { allowed });
  }
  await getContactOr404(db, workspaceId, contactId);
  await db.query(
    `insert into crm.contact_channels (contact_id, channel, status, reason, updated_by)
     values ($1, $2, $3, $4, $5)
     on conflict (contact_id, channel)
     do update set status = excluded.status, reason = excluded.reason, updated_by = excluded.updated_by`,
    [contactId, input.channel, input.status, input.reason ?? null, actor.id],
  );
  await addTimelineEvent(db, { contactId, kind: "system", title: `${input.channel} contactability: ${input.status}`, detail: input.reason, ...actorEvent(actor) });
  return listContactability(db, workspaceId, contactId);
}

export async function listContactability(db: Queryable, workspaceId: string, contactId: string) {
  await getContactOr404(db, workspaceId, contactId);
  const result = await db.query<{ channel: ContactChannel; status: string; reason: string | null; updated_at: Date }>(
    `select channel, status, reason, updated_at from crm.contact_channels where contact_id = $1 order by channel`,
    [contactId],
  );
  return result.rows.map((r) => ({ channel: r.channel, status: r.status, reason: r.reason ?? undefined, updatedAt: r.updated_at.toISOString() }));
}

/** Records a manual email/WhatsApp the rep sent outside the CRM (no provider send). */
export async function logManualCommunication(
  db: Queryable,
  actor: Actor,
  workspaceId: string,
  contactId: string,
  input: { channel: "email" | "whatsapp"; detail?: string; dealId?: string },
) {
  const contact = await getContactOr404(db, workspaceId, contactId);
  if (contact.status === "do_not_contact") throw new DoNotContactError();
  const title = input.channel === "email" ? "Email Sent" : "WhatsApp Sent";
  await addTimelineEvent(db, {
    contactId,
    dealId: input.dealId ?? contact.open_deal_id,
    kind: input.channel,
    title,
    detail: input.detail?.trim() || `Manual ${input.channel} from contact record`,
    ...actorEvent(actor),
  });
  await db.query(`update crm.contacts set last_activity_at = now() where id = $1`, [contactId]);
  await advanceLifecycle(db, contactId, "contacted", actor);
  return { channel: input.channel, title };
}

// --- Lifecycle stage ---------------------------------------------------------------------

/**
 * Moves a contact's lifecycle forward only (relies on the enum's declared order). Returns
 * true when it moved. Used by activity and deal code; never moves a stage back.
 */
export async function advanceLifecycle(db: Queryable, contactId: string, stage: LifecycleStage, actor: Actor | EventActor | null) {
  const moved = await db.query(
    `update crm.contacts set lifecycle_stage = $2, lifecycle_changed_at = now()
      where id = $1 and lifecycle_stage < $2::crm.lifecycle_stage`,
    [contactId, stage],
  );
  if (!moved.rowCount) return false;
  await addTimelineEvent(db, { contactId, kind: "lifecycle", title: `Lifecycle: ${stage}`, ...toEventActor(actor) });
  return true;
}

/**
 * Manual change. Forward: any CRM user. Back: admins only, with a note (kept on the timeline).
 */
export async function setLifecycleStage(db: Queryable, actor: Actor, workspaceId: string, contactId: string, input: { stage: LifecycleStage; note?: string }) {
  const current = await getContactOr404(db, workspaceId, contactId);
  if (current.lifecycle_stage === input.stage) return current;
  const backwards = lifecycleIndex(input.stage) < lifecycleIndex(current.lifecycle_stage);
  const note = input.note?.trim();
  if (backwards) {
    if (actor.role !== "admin") throw new ForbiddenError("Only an admin can move a lifecycle stage back.");
    if (!note) throw new ValidationError("A note is required to move a lifecycle stage back.", { field: "note" });
  }
  await db.query(`update crm.contacts set lifecycle_stage = $2, lifecycle_changed_at = now() where id = $1`, [contactId, input.stage]);
  await addTimelineEvent(db, {
    contactId,
    kind: "lifecycle",
    title: `Lifecycle: ${current.lifecycle_stage} -> ${input.stage}${backwards ? " (moved back)" : ""}`,
    detail: note ?? null,
    ...actorEvent(actor),
  });
  return getContactOr404(db, workspaceId, contactId);
}

// --- Merge -----------------------------------------------------------------------------------

/**
 * Merges `sourceId` into `targetId` (same workspace). Blocked if both have an open deal.
 * Moves deals first, then tasks' contact_id (so the task/deal contact rule holds), then all
 * other activity and external refs. If either contact is DNC the target becomes DNC. The
 * source is kept as a `merged` tombstone pointing at the target.
 */
export async function mergeContacts(db: Queryable, actor: Actor, workspaceId: string, sourceId: string, targetId: string, reason?: string) {
  if (sourceId === targetId) throw new ValidationError("A contact cannot be merged into itself.");
  const locked = await db.query<{ id: string }>(
    `select id from crm.contacts where id = any($1::uuid[]) and workspace_id = $2 order by id for update`,
    [[sourceId, targetId], workspaceId],
  );
  if (locked.rows.length !== 2) throw new NotFoundError("Contact");
  const source = await getContactOr404(db, workspaceId, sourceId);
  const target = await getContactOr404(db, workspaceId, targetId);
  if (source.status === "merged") throw new ConflictError("Source contact is already merged.");
  if (target.status === "merged") throw new ConflictError("Target contact is itself merged into another contact.");
  if (source.open_deal_id && target.open_deal_id) {
    throw new ConflictError("Both contacts have an open deal. Close or park one of the deals before merging.", {
      sourceDealId: source.open_deal_id,
      targetDealId: target.open_deal_id,
    });
  }

  await db.query(`update crm.deals set contact_id = $2 where contact_id = $1`, [sourceId, targetId]);
  await db.query(`update crm.tasks set contact_id = $2 where contact_id = $1`, [sourceId, targetId]);
  for (const table of ["workflow_runs", "notes", "calls", "timeline_events", "notifications", "email_activities", "external_refs", "whatsapp_outbound_messages", "whatsapp_inbound_events"]) {
    await db.query(`update crm.${table} set contact_id = $2 where contact_id = $1`, [sourceId, targetId]);
  }

  if (source.status === "do_not_contact" && target.status !== "do_not_contact") {
    await db.query(
      `update crm.contacts set status = 'do_not_contact', dnc_reason = $2, dnc_by = $3, dnc_by_name = $4, dnc_at = now() where id = $1`,
      [targetId, `Merged from a Do Not Contact contact: ${source.dnc_reason ?? "no reason recorded"}`, actor.id, actor.fullName],
    );
  }
  if (lifecycleIndex(source.lifecycle_stage) > lifecycleIndex(target.lifecycle_stage)) {
    await advanceLifecycle(db, targetId, source.lifecycle_stage, actor);
  }
  await db.query(
    `update crm.contacts set status = 'merged', merged_into_contact_id = $2, last_activity_at = now() where id = $1`,
    [sourceId, targetId],
  );

  const name = (c: ContactRow) => `${c.first_name} ${c.last_name}`.trim();
  await addTimelineEvent(db, { contactId: sourceId, kind: "system", title: "Merged", detail: reason ?? `Merged into ${name(target)}`, ...actorEvent(actor) });
  await addTimelineEvent(db, { contactId: targetId, kind: "system", title: "Absorbed Duplicate Contact", detail: reason ?? `Absorbed ${name(source)}`, ...actorEvent(actor) });
  return getContactOr404(db, workspaceId, targetId);
}

// --- CSV import ----------------------------------------------------------------------------

export interface ImportContactRowInput extends ContactFieldsInput {
  rowNumber: number;
  company?: string;
  website?: string;
  industry?: string;
  /** CSV "create_deal" column: true, or yes/y/true/1. */
  createDeal?: boolean | string;
  /** CSV "deal_title" column; non-empty also asks for a deal. Stored as the deal's service interest (deals have no title). */
  dealTitle?: string;
}

/** A row asks for a deal with create_deal = yes/true/1, or any deal_title. */
export function rowWantsDeal(row: Pick<ImportContactRowInput, "createDeal" | "dealTitle">): boolean {
  const flag = typeof row.createDeal === "string" ? ["yes", "y", "true", "1"].includes(row.createDeal.trim().toLowerCase()) : row.createDeal === true;
  return flag || !!row.dealTitle?.trim();
}

export interface ImportRowOutcome {
  rowNumber: number;
  reason: string;
}

/**
 * Partial import: invalid rows and duplicates (same email/phone as an existing contact in this
 * workspace, or an earlier row in the file) are skipped and reported. Each row's company is
 * matched by domain/name or created. New contacts are prospects; only rows that ask for a deal
 * (rowWantsDeal) also get an open deal, which makes them qualified.
 */
export async function importContacts(
  db: Queryable,
  actor: Actor,
  workspaceId: string,
  rows: ImportContactRowInput[],
) {
  const failed: ImportRowOutcome[] = [];
  const duplicates: ImportRowOutcome[] = [];
  const created: string[] = [];

  const valid: { row: ImportContactRowInput; fields: ValidatedContactFields }[] = [];
  for (const row of rows) {
    try {
      valid.push({ row, fields: validateContactFields(row) });
    } catch (err) {
      failed.push({ rowNumber: row.rowNumber, reason: err instanceof ValidationError ? err.message : "Invalid row." });
    }
  }

  const emails = [...new Set(valid.flatMap((v) => (v.fields.email ? [v.fields.email] : [])))];
  const phones = [...new Set(valid.flatMap((v) => (v.fields.phoneE164 ? [v.fields.phoneE164] : [])))];
  const existing = await db.query<{ email: string | null; phone_e164: string | null }>(
    `select lower(email) as email, phone_e164 from crm.contacts
      where workspace_id = $1 and (lower(email) = any($2::text[]) or phone_e164 = any($3::text[]))`,
    [workspaceId, emails, phones],
  );
  const seenEmails = new Set(existing.rows.flatMap((r) => (r.email ? [r.email] : [])));
  const seenPhones = new Set(existing.rows.flatMap((r) => (r.phone_e164 ? [r.phone_e164] : [])));
  const dbEmails = new Set(seenEmails);
  const dbPhones = new Set(seenPhones);
  const companyIds = new Map<string, string>();

  for (const { row, fields } of valid) {
    const email = fields.email;
    const phone = fields.phoneE164;
    if ((email && seenEmails.has(email)) || (phone && seenPhones.has(phone))) {
      const inDb = (email && dbEmails.has(email)) || (phone && dbPhones.has(phone));
      duplicates.push({
        rowNumber: row.rowNumber,
        reason: inDb ? "Matches an existing contact by email or phone." : "Duplicate of another row earlier in this file.",
      });
      continue;
    }
    if (email) seenEmails.add(email);
    if (phone) seenPhones.add(phone);

    let companyId: string | null = null;
    const companyName = row.company?.trim();
    if (companyName) {
      const key = companyName.toLowerCase();
      companyId = companyIds.get(key) ?? (await findOrCreateCompany(db, actor, workspaceId, { name: companyName, website: row.website, industry: row.industry }));
      companyIds.set(key, companyId);
    }

    const id = await insertContact(db, actor, workspaceId, fields, companyId, defaultOwner(actor));
    await addTimelineEvent(db, { contactId: id, kind: "system", title: "Contact Created", detail: `Source: ${fields.source} (CSV import)`, ...actorEvent(actor) });
    if (rowWantsDeal(row)) await createDeal(db, actor, workspaceId, { contactId: id, serviceInterest: row.dealTitle });
    created.push(id);
  }

  return { created, duplicates, failed, totalRows: rows.length };
}
