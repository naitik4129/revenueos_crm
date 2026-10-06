import type { Queryable } from "../dto.js";
import { addDaysIso } from "../dto.js";
import { ValidationError } from "../errors.js";
import { formatSubmissionDetail, normalizeWebsiteForm, type NormalizedWebsiteForm, type RawWebsiteForm } from "../domain/websiteForm.js";
import { validateLeadFields } from "./leads.service.js";
import { createTask } from "./tasks.service.js";
import { addTimelineEvent, SYSTEM_ACTOR } from "./timeline.service.js";

export type IngestOutcome =
  | { status: "created"; leadId: string }
  | { status: "duplicate"; leadId: string }
  | { status: "rejected"; reason: string };

const CREATED_BY_LABEL = "Website form";
const SUBMISSION_TITLE = "Website form submission";
const RESUBMISSION_TITLE = "Website form submitted again";
/** An identical resubmission inside this window (double click, website retry) is absorbed silently. */
const REPEAT_WINDOW_MINUTES = 10;

/**
 * Serializes concurrent submissions for the same person. There is no unique
 * index on lead email/phone (and no migration is allowed for this feature), so
 * two simultaneous requests could otherwise both miss each other's insert and
 * create twin leads. Keys are locked in sorted order so two requests that
 * share both an email and a phone can never deadlock. Transaction-scoped:
 * released automatically on commit/rollback. Must run inside a transaction.
 */
async function lockSubmitter(db: Queryable, workspaceId: string, form: NormalizedWebsiteForm) {
  const keys = [
    ...(form.email ? [`${workspaceId}:email:${form.email}`] : []),
    ...(form.phoneE164 ? [`${workspaceId}:phone:${form.phoneE164}`] : []),
  ].sort();
  for (const key of keys) {
    await db.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [key]);
  }
}

interface OwnerProfile {
  id: string;
  fullName: string;
}

/**
 * The workspace's configured default owner (Settings -> Website leads), or
 * null when none is set. A saved owner who has since been deactivated or is no
 * longer a salesperson is ignored: that must never cost us the lead, so it
 * falls back to unassigned (and says so in the logs).
 */
async function resolveOwner(db: Queryable, workspaceId: string): Promise<OwnerProfile | null> {
  // A savepoint keeps a failed lookup (e.g. migration 018 not applied yet)
  // from aborting the whole transaction: the lead is still created, unassigned.
  await db.query("savepoint resolve_default_owner");
  try {
    const result = await db.query<{ configured: string | null; id: string | null; full_name: string | null }>(
      `select w.default_lead_owner_id as configured, p.id, p.full_name
         from public.workspaces w
         left join public.profiles p
           on p.id = w.default_lead_owner_id and p.role = 'salesperson' and p.is_active = true
        where w.id = $1`,
      [workspaceId],
    );
    await db.query("release savepoint resolve_default_owner");
    const row = result.rows[0];
    if (!row?.configured) return null;
    if (!row.id || !row.full_name) {
      console.warn(JSON.stringify({ event: "website_lead_owner_unavailable", reason: "configured default owner is not an active salesperson" }));
      return null;
    }
    return { id: row.id, fullName: row.full_name };
  } catch (err) {
    await db.query("rollback to savepoint resolve_default_owner");
    console.warn(JSON.stringify({ event: "website_lead_owner_lookup_failed", message: err instanceof Error ? err.message : String(err) }));
    return null;
  }
}

async function findExistingLead(db: Queryable, workspaceId: string, form: NormalizedWebsiteForm) {
  const result = await db.query<{ id: string; lifecycle_state: string; owner_id: string | null }>(
    `select id, lifecycle_state, owner_id
       from public.leads
      where workspace_id = $1
        and lifecycle_state <> 'merged'
        and (($2::text is not null and lower(email) = $2::text)
          or ($3::text is not null and phone_e164 = $3::text))
      order by (case when $2::text is not null and lower(email) = $2::text then 0 else 1 end), created_at desc
      limit 1`,
    [workspaceId, form.email, form.phoneE164],
  );
  return result.rows[0] ?? null;
}

/**
 * Notifies the lead's owner when it has one (and is an active salesperson),
 * otherwise every active salesperson so an unassigned lead is still seen.
 */
async function notifyAboutLead(db: Queryable, workspaceId: string, leadId: string, ownerId: string | null, title: string, detail: string) {
  const result = await db.query(
    `insert into public.notifications (workspace_id, recipient_id, title, detail, kind, lead_id, href)
     select $1, p.id, $2, $3, 'info'::public.notification_kind, $4, $5
       from public.profiles p
      where p.role = 'salesperson' and p.is_active = true
        and ($6::uuid is null or p.id = $6::uuid)`,
    [workspaceId, title, detail, leadId, `/leads/${leadId}`, ownerId],
  );
  // The owner was deactivated or is no longer a salesperson: tell everyone instead.
  if (ownerId && !result.rowCount) await notifyAboutLead(db, workspaceId, leadId, null, title, detail);
}

function displayName(form: NormalizedWebsiteForm): string {
  return `${form.firstName} ${form.lastName}`.trim();
}

function submissionMetadata(form: NormalizedWebsiteForm): Record<string, unknown> {
  return {
    channel: "website_form",
    industry: form.industry,
    revenueRange: form.revenueRange,
    diagnosisIssue: form.diagnosisIssue,
    invalidPhone: form.invalidPhone,
    rawMessage: form.message,
  };
}

/**
 * Creates (or, for a known person, annotates) a lead from a public website
 * form submission. Self-contained on purpose: it only *calls* existing
 * helpers and never modifies createLead/importLeads, so the in-app flows are
 * untouched. Differences from an in-app createLead, all deliberate:
 *  - no acting user: events are written as SYSTEM and created_by is null. The
 *    lead is owned by the workspace's configured default owner (Settings ->
 *    Website leads) while that person is an active salesperson; otherwise it
 *    stays unassigned and every active salesperson is notified;
 *  - no workflow enrollment (no automatic email/WhatsApp to the visitor);
 *  - a repeat submitter updates the existing lead's timeline instead of
 *    creating a second lead, and never changes its stage/lifecycle/DNC state.
 *
 * Must be called inside a transaction so the lead, its events, its task and
 * the notifications are all-or-nothing.
 */
export async function ingestWebsiteLead(db: Queryable, workspaceId: string, raw: RawWebsiteForm): Promise<IngestOutcome> {
  const form = normalizeWebsiteForm(raw);
  if (!form.email && !form.phoneE164) {
    return { status: "rejected", reason: "A valid email address or phone number is required." };
  }

  await lockSubmitter(db, workspaceId, form);

  const detail = formatSubmissionDetail(form);
  const existing = await findExistingLead(db, workspaceId, form);

  if (existing) {
    const repeat = await db.query(
      `select 1 from public.timeline_events
        where lead_id = $1
          and title in ($2, $3)
          and detail = $4
          and created_at > now() - make_interval(mins => $5::int)
        limit 1`,
      [existing.id, SUBMISSION_TITLE, RESUBMISSION_TITLE, detail, REPEAT_WINDOW_MINUTES],
    );
    if (repeat.rowCount) return { status: "duplicate", leadId: existing.id };

    await addTimelineEvent(db, {
      leadId: existing.id,
      kind: "system",
      title: RESUBMISSION_TITLE,
      detail,
      metadata: submissionMetadata(form),
      ...SYSTEM_ACTOR,
    });
    await db.query(`update public.leads set last_activity_at = now() where id = $1`, [existing.id]);

    const stateNote = existing.lifecycle_state === "active" ? "" : ` This lead is currently "${existing.lifecycle_state}" - nothing was changed automatically.`;
    await notifyAboutLead(
      db,
      workspaceId,
      existing.id,
      existing.owner_id,
      "Website form submitted again",
      `${displayName(form)} (${form.company}) submitted the website form again.${stateNote}`,
    );
    return { status: "duplicate", leadId: existing.id };
  }

  let fields;
  try {
    fields = validateLeadFields({
      firstName: form.firstName,
      lastName: form.lastName,
      company: form.company,
      industry: form.industry ?? undefined,
      email: form.email ?? undefined,
      phone: form.phone ?? undefined,
      source: "website",
    });
  } catch (err) {
    if (err instanceof ValidationError) return { status: "rejected", reason: err.message };
    throw err;
  }

  const owner = await resolveOwner(db, workspaceId);

  const inserted = await db.query<{ id: string }>(
    `insert into public.leads
      (workspace_id, first_name, last_name, company, job_title, industry, email, phone, phone_e164, source,
       service_interest, owner_id, created_by, created_by_name)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     returning id`,
    [
      workspaceId,
      fields.firstName,
      fields.lastName,
      fields.company,
      fields.jobTitle,
      fields.industry,
      fields.email,
      fields.phone,
      fields.phoneE164,
      fields.source,
      fields.serviceInterest,
      owner?.id ?? null,
      null,
      CREATED_BY_LABEL,
    ],
  );
  const leadId = inserted.rows[0]!.id;

  await addTimelineEvent(db, { leadId, kind: "system", title: "Lead Created", detail: "Source: website (website form)", ...SYSTEM_ACTOR });
  if (owner) {
    await addTimelineEvent(db, { leadId, kind: "system", title: "Lead Assigned", detail: `Owner: ${owner.fullName}`, ...SYSTEM_ACTOR });
  }
  await addTimelineEvent(db, {
    leadId,
    kind: "system",
    title: SUBMISSION_TITLE,
    detail,
    metadata: submissionMetadata(form),
    ...SYSTEM_ACTOR,
  });

  // Same rule as every other lead: a new active lead always has a next
  // action, owned by the lead's owner (or unassigned if there is none).
  await createTask(db, null, workspaceId, {
    leadId,
    ownerId: owner?.id ?? null,
    ownerName: owner?.fullName ?? null,
    type: "call",
    title: "First call",
    dueAt: addDaysIso(0),
    origin: "manual",
  });

  await notifyAboutLead(db, workspaceId, leadId, owner?.id ?? null, "New website lead", `${displayName(form)} (${form.company}) submitted the website form.`);
  return { status: "created", leadId };
}
