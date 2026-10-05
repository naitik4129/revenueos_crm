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

async function findExistingLead(db: Queryable, workspaceId: string, form: NormalizedWebsiteForm) {
  const result = await db.query<{ id: string; lifecycle_state: string }>(
    `select id, lifecycle_state
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

/** One notification row per active salesperson (the lead is unassigned, so everyone sees it). */
async function notifySalespeople(db: Queryable, workspaceId: string, leadId: string, title: string, detail: string) {
  await db.query(
    `insert into public.notifications (workspace_id, recipient_id, title, detail, kind, lead_id, href)
     select $1, p.id, $2, $3, 'info'::public.notification_kind, $4, $5
       from public.profiles p
      where p.role = 'salesperson' and p.is_active = true`,
    [workspaceId, title, detail, leadId, `/leads/${leadId}`],
  );
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
 *  - no acting user: events are written as SYSTEM, owner and created_by are
 *    null (the lead is unassigned and every salesperson is notified);
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
    await notifySalespeople(db, workspaceId, existing.id, "Website form submitted again", `${displayName(form)} (${form.company}) submitted the website form again.${stateNote}`);
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
      null,
      null,
      CREATED_BY_LABEL,
    ],
  );
  const leadId = inserted.rows[0]!.id;

  await addTimelineEvent(db, { leadId, kind: "system", title: "Lead Created", detail: "Source: website (website form)", ...SYSTEM_ACTOR });
  await addTimelineEvent(db, {
    leadId,
    kind: "system",
    title: SUBMISSION_TITLE,
    detail,
    metadata: submissionMetadata(form),
    ...SYSTEM_ACTOR,
  });

  // Same rule as every other lead: a new active lead always has a next
  // action. Unassigned here - any salesperson can pick it up.
  await createTask(db, null, workspaceId, {
    leadId,
    ownerId: null,
    type: "call",
    title: "First call",
    dueAt: addDaysIso(0),
    origin: "manual",
  });

  await notifySalespeople(db, workspaceId, leadId, "New website lead", `${displayName(form)} (${form.company}) submitted the website form.`);
  return { status: "created", leadId };
}
