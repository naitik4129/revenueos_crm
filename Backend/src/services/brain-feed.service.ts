/**
 * Brain feed reader: copies the brain's data into the CRM by reading the read-only views
 * public.brain_feed_* (migration 018, the contract with the brain, Quickhowl and the Email Tool).
 * CLAUDE.md "Brain feed".
 *
 *  - A workspace takes part when its platform project has a brain_customer_key; the views' rows
 *    with that `customer` go to it.
 *  - Each view is paged by (updated_at, id) from a bookmark in crm_brain_feed_cursors, so a run
 *    reads only what changed. Rows are written through the brain API's own batch path
 *    (runBatch + the set-based handlers), so every intake rule holds: idempotent by external id,
 *    brain data only fills empty fields, contact match order, lifecycle forward only.
 *  - An item the intake refuses is counted and logged; the bookmark still moves past it.
 */
import type { z } from "zod";
import { addDaysIso, type Queryable } from "../dto.js";
import { pool, withTransaction } from "../db.js";
import { PIPELINE_STAGES } from "../domain/enums.js";
import * as bulk from "./brain-bulk.service.js";
import {
  applyHandover,
  callItem,
  companyItem,
  contactItem,
  emailEventItem,
  MAX_BATCH,
  runBatch,
  upsertCall,
  upsertCompany,
  upsertContact,
  upsertEmailEvent,
  type BulkHandler,
  type ItemOutcome,
  type ItemResult,
} from "./brain.service.js";
import { getDealOr404, updateDeal } from "./deals.service.js";
import { cancelOpenTasksForDeal, createTask } from "./tasks.service.js";
import { addTimelineEvent, BRAIN_ACTOR } from "./timeline.service.js";

/** In run order: people link to companies; calls and emails find their contacts; outcomes land on sent emails. */
export const FEEDS = ["companies", "people", "calls", "emails", "email_outcomes"] as const;
export type Feed = (typeof FEEDS)[number];

/** Pages a single run may take per workspace and feed; the next run carries on from the bookmark. */
export const MAX_PAGES_PER_RUN = 20;

export interface FeedWorkspace {
  workspaceId: string;
  customer: string;
}

/** Active workspaces linked to a platform project that has a brain customer key. */
export async function feedWorkspaces(db: Queryable = pool): Promise<FeedWorkspace[]> {
  const r = await db.query<{ workspace_id: string; customer: string }>(
    `select w.id as workspace_id, p.brain_customer_key as customer
       from crm_workspaces w
       join public.revenueos_projects p on p.id = w.platform_project_id
      where w.is_active and p.brain_customer_key is not null and length(trim(p.brain_customer_key)) > 0
      order by w.created_at, w.id`,
  );
  return r.rows.map((row) => ({ workspaceId: row.workspace_id, customer: row.customer }));
}

type Row = Record<string, unknown> & { id: string; cursor_at: string };
const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));

/** How one view becomes brain intake items: the same schema, set-based handler and per-item fallback as its /brain/v1 route. */
interface FeedSpec<T> {
  view: string;
  /** Columns read besides id and updated_at. */
  columns: string;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** One intake item per row, or several (an email row = its sent, opened and bounced events, in that order). */
  toItem: (row: Row) => unknown;
  toItems?: (row: Row) => unknown[];
  handle: (db: Queryable, workspaceId: string, item: T) => Promise<ItemOutcome>;
  bulk: BulkHandler<T>;
  /** Rows not to write yet (e.g. a call still in progress); the bookmark still moves past them. */
  skip?: (row: Row) => boolean;
  /** After a page is written: what follows from each written row. Returns the rows that failed here. */
  after?: (ws: FeedWorkspace, written: { row: Row; result: ItemResult }[]) => Promise<{ id: string; message: string }[]>;
}

const spec = <T>(s: FeedSpec<T>) => s as unknown as FeedSpec<unknown>;

const SPECS: Record<Feed, FeedSpec<unknown>> = {
  companies: spec<z.infer<typeof companyItem>>({
    view: "brain_feed_companies",
    columns: "name, website, industry, location, headcount, phone, linkedin_url",
    schema: companyItem,
    toItem: (r) => ({
      source: "quickicp",
      externalId: String(r.id),
      name: str(r.name) ?? "",
      website: str(r.website),
      industry: str(r.industry),
      location: str(r.location),
      headcount: r.headcount === null || r.headcount === undefined ? null : Number(r.headcount),
      phone: str(r.phone),
      linkedinUrl: str(r.linkedin_url),
    }),
    handle: upsertCompany,
    bulk: bulk.bulkCompanies,
  }),
  people: spec<z.infer<typeof contactItem>>({
    view: "brain_feed_people",
    columns: "company_id, full_name, job_title, email, phone, linkedin_url, country, location",
    schema: contactItem,
    toItem: (r) => ({
      source: "quickicp",
      externalId: String(r.id),
      fullName: str(r.full_name),
      jobTitle: str(r.job_title),
      email: str(r.email),
      phone: str(r.phone),
      linkedinUrl: str(r.linkedin_url),
      country: str(r.country),
      location: str(r.location),
      companyRef: r.company_id === null || r.company_id === undefined ? undefined : { source: "quickicp", externalId: String(r.company_id) },
    }),
    handle: upsertContact,
    bulk: bulk.bulkContacts,
  }),
  calls: spec<z.infer<typeof callItem>>({
    view: "brain_feed_calls",
    columns: "phone, contact_name, contact_email, direction, status, outcome, connected, started_at, duration_seconds, summary, sentiment, transcript, recording_url",
    schema: callItem,
    toItem: (r) => ({
      source: "quickhowl",
      externalId: String(r.id),
      contact: { fullName: str(r.contact_name), email: str(r.contact_email), phone: str(r.phone) },
      direction: r.direction === "inbound" ? "inbound" : "outbound",
      connected: r.connected === true,
      outcome: str(r.outcome),
      startedAt: r.started_at instanceof Date ? r.started_at.toISOString() : undefined,
      durationSeconds: r.duration_seconds === null || r.duration_seconds === undefined ? null : Number(r.duration_seconds),
      summary: str(r.summary),
      sentiment: str(r.sentiment),
      transcript: str(r.transcript),
      recordingUrl: str(r.recording_url),
      dnc: r.outcome === "do_not_call",
    }),
    handle: upsertCall,
    bulk: bulk.bulkCalls,
    // Still ringing, connected or without a result: taken when Quickhowl updates it (updated_at moves).
    skip: (r) => r.outcome === "pending" || ["initiated", "ringing", "connected"].includes(String(r.status)),
    after: applyCallOutcomes,
  }),
  // One sent campaign email: its sent event, then (if any) the first open and a hard bounce, as the
  // /email-events intake takes them (status only moves up; each event time is kept from first sight).
  emails: spec<z.infer<typeof emailEventItem>>({
    view: "brain_feed_emails",
    columns: "campaign_id, campaign_name, step, subject, to_email, sent_at, opened_at, bounced_at, bounce_type",
    schema: emailEventItem,
    toItem: () => {
      throw new Error("emails use toItems");
    },
    toItems: (r) => {
      const base = {
        source: "email_tool",
        messageId: String(r.id),
        contact: { email: str(r.to_email) },
        campaignRef: str(r.campaign_id),
        campaignName: str(r.campaign_name),
        step: r.step === null || r.step === undefined ? undefined : Number(r.step),
        subject: str(r.subject),
      };
      const at = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
      const items: unknown[] = [{ ...base, event: "sent", occurredAt: at(r.sent_at) }];
      if (r.opened_at) items.push({ ...base, event: "opened", occurredAt: at(r.opened_at) });
      // Soft bounces are retried by the Email Tool; only a hard bounce blocks the address.
      if (r.bounced_at && r.bounce_type === "HARD") items.push({ ...base, event: "bounced", occurredAt: at(r.bounced_at) });
      return items;
    },
    handle: upsertEmailEvent,
    bulk: bulk.bulkEmailEvents,
  }),
  // A recipient's outcome in a campaign (per enrollment). It lands on the latest email sent to that
  // enrollment, so the reply or unsubscribe shows on the email it answered; with none, on its own row.
  email_outcomes: spec<z.infer<typeof emailEventItem>>({
    view: "brain_feed_email_outcomes",
    columns: `campaign_id, kind, occurred_at, email, reply_text,
      (select e.id::text from public.brain_feed_emails e where e.enrollment_id = f.enrollment_id order by e.sent_at desc, e.id desc limit 1) as message_id,
      f.enrollment_id::text as enrollment_key`,
    schema: emailEventItem,
    toItem: (r) => ({
      source: "email_tool",
      messageId: str(r.message_id) ?? `enrollment:${String(r.enrollment_key)}`,
      contact: { email: str(r.email) },
      campaignRef: str(r.campaign_id),
      // A complaint blocks email like an unsubscribe (as the Resend webhook does for workflow emails).
      event: ({ REPLIED: "replied", UNSUBSCRIBED: "unsubscribed", HARD_BOUNCE: "bounced", COMPLAINT: "unsubscribed" } as Record<string, string>)[String(r.kind)] ?? "invalid",
      occurredAt: r.occurred_at instanceof Date ? r.occurred_at.toISOString() : String(r.occurred_at),
      replyText: r.kind === "REPLIED" ? str(r.reply_text) : null,
    }),
    handle: upsertEmailEvent,
    bulk: bulk.bulkEmailEvents,
  }),
};

// --- What an AI call's outcome does (CLAUDE.md "Brain feed": the human's mapping) -------------------

const MEETING_SCHEDULING = PIPELINE_STAGES.indexOf("meeting_scheduling");

/** 10:00 Asia/Kolkata on the next weekday. */
export function nextWorkingDayIst(from: Date = new Date()): string {
  const ist = new Date(from.getTime() + 330 * 60_000);
  const day = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1));
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() + 1);
  return new Date(day.getTime() + (10 * 60 - 330) * 60_000).toISOString();
}

const callContact = (r: Row) => ({ fullName: str(r.contact_name), email: str(r.contact_email), phone: str(r.phone) });

/**
 * interested -> a qualified handover (reuse / reopen / create the deal, default owner, notify),
 * then the 'positive' call routing: stage Meeting Scheduling (never backwards), stale follow-ups
 * cancelled, one "Schedule discovery meeting" task. callback_requested -> one call task, no deal.
 * wrong_number -> phone channel wrong_number. (do_not_call is the call item's dnc flag.)
 * Each runs at most once per call: the handover and the callback are keyed by the call id.
 */
async function applyCallOutcomes(ws: FeedWorkspace, written: { row: Row; result: ItemResult }[]) {
  const failed: { id: string; message: string }[] = [];
  for (const { row, result } of written) {
    if (!["interested", "callback_requested", "wrong_number"].includes(String(row.outcome)) || !result.id) continue;
    try {
      await withTransaction(async (db) => {
        const call = (await db.query<{ contact_id: string }>(`select contact_id from crm_calls where id = $1`, [result.id])).rows[0];
        if (!call) return;
        if (row.outcome === "interested") await interested(db, ws, row, result.id!);
        else if (row.outcome === "callback_requested") await callbackRequested(db, ws, row, call.contact_id);
        else await wrongNumber(db, call.contact_id);
      });
    } catch (err) {
      console.error(`[brain-feed] workspace ${ws.workspaceId} call ${row.id} (${String(row.outcome)}) failed:`, err);
      failed.push({ id: row.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return failed;
}

async function interested(db: Queryable, ws: FeedWorkspace, row: Row, callId: string) {
  const handover = await applyHandover(db, ws.workspaceId, {
    source: "quickhowl",
    externalId: `call:${row.id}`,
    contact: callContact(row),
    summary: str(row.summary) ?? "Interested on an AI call.",
  });
  if (handover.status === "unchanged" || !handover.id) return;
  const dealId = handover.id;
  await db.query(`update crm_calls set deal_id = $2 where id = $1 and deal_id is null`, [callId, dealId]);

  const deal = await getDealOr404(db, ws.workspaceId, dealId);
  if (PIPELINE_STAGES.indexOf(deal.stage) < MEETING_SCHEDULING) await updateDeal(db, null, ws.workspaceId, dealId, { stage: "meeting_scheduling" });
  // A new deal starts with a "First call" task; here the call already happened (as for a human call's
  // positive outcome, which creates its deal without one), so the next action is the meeting.
  const stale: ("follow_up" | "nurture" | "call")[] = handover.status === "created" ? ["follow_up", "nurture", "call"] : ["follow_up", "nurture"];
  await cancelOpenTasksForDeal(db, null, dealId, "Superseded by positive call outcome", stale);
  const open = await db.query(`select 1 from crm_tasks where deal_id = $1 and status = 'open' and task_type = 'schedule_meeting'`, [dealId]);
  if (!open.rows[0]) {
    await createTask(db, BRAIN_ACTOR, ws.workspaceId, { dealId, ownerId: deal.owner_id, type: "schedule_meeting", title: "Schedule discovery meeting", dueAt: addDaysIso(1) });
  }
}

async function callbackRequested(db: Queryable, ws: FeedWorkspace, row: Row, contactId: string) {
  // The marker event makes it once per call (unique workspace + external source + id).
  const marker = await db.query(
    `select 1 from crm_timeline_events where workspace_id = $1 and external_source = 'quickhowl' and external_id = $2`,
    [ws.workspaceId, `callback:${row.id}`],
  );
  if (marker.rows[0]) return;
  const ctx = (
    await db.query<{ deal_id: string | null; deal_owner: string | null; contact_owner: string | null; default_owner: string | null }>(
      `select d.id as deal_id, d.owner_id as deal_owner, c.owner_id as contact_owner, w.default_owner_id as default_owner
         from crm_contacts c join crm_workspaces w on w.id = c.workspace_id
         left join crm_deals d on d.contact_id = c.id and d.outcome = 'open'
        where c.id = $1`,
      [contactId],
    )
  ).rows[0]!;
  await addTimelineEvent(db, {
    contactId,
    dealId: ctx.deal_id,
    kind: "call",
    title: "Callback Requested (AI call)",
    detail: str(row.summary),
    external: { source: "quickhowl", id: `callback:${row.id}` },
    ...BRAIN_ACTOR,
  });
  await createTask(db, BRAIN_ACTOR, ws.workspaceId, {
    ...(ctx.deal_id ? { dealId: ctx.deal_id } : { contactId }),
    ownerId: ctx.deal_owner ?? ctx.contact_owner ?? ctx.default_owner,
    type: "call",
    title: "Callback requested by lead",
    dueAt: nextWorkingDayIst(),
  });
}

async function wrongNumber(db: Queryable, contactId: string) {
  // Never downgrades a Do Not Contact phone.
  await db.query(
    `insert into crm_contact_channels (contact_id, channel, status, reason) values ($1, 'phone', 'wrong_number', 'AI call: wrong number')
     on conflict (contact_id, channel) do update set status = excluded.status, reason = excluded.reason
       where crm_contact_channels.status <> 'do_not_contact'`,
    [contactId],
  );
}

export interface FeedRunResult {
  feed: Feed;
  read: number;
  created: number;
  updated: number;
  unchanged: number;
  /** Rows passed over for now (see FeedSpec.skip). */
  skipped: number;
  failed: number;
}

/**
 * Reads one view for one workspace from its bookmark, up to MAX_PAGES_PER_RUN pages of
 * `pageSize` rows, writing each page through the brain intake and moving the bookmark after it.
 */
export async function syncFeed(ws: FeedWorkspace, feed: Feed, opts: { pageSize?: number; db?: Queryable } = {}): Promise<FeedRunResult> {
  const db = opts.db ?? pool;
  const pageSize = Math.min(opts.pageSize ?? MAX_BATCH, MAX_BATCH);
  const spec = SPECS[feed];
  const result: FeedRunResult = { feed, read: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 };
  await db.query(`insert into crm_brain_feed_cursors (workspace_id, feed) values ($1, $2) on conflict do nothing`, [ws.workspaceId, feed]);

  for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
    // The bookmark is compared in SQL (timestamptz to timestamptz) so no precision is lost on the way.
    const rows = (
      await db.query<Row>(
        `select ${spec.columns}, f.id::text as id, f.updated_at::text as cursor_at
           from public.${spec.view} f
           join crm_brain_feed_cursors c on c.workspace_id = $1 and c.feed = $2
          where f.customer = $3
            and (c.last_updated_at is null or (f.updated_at, f.id::text) > (c.last_updated_at, c.last_id))
          order by f.updated_at, f.id::text
          limit $4`,
        [ws.workspaceId, feed, ws.customer, pageSize],
      )
    ).rows;
    if (!rows.length) break;

    const take = spec.skip ? rows.filter((r) => !spec.skip!(r)) : rows;
    // Items in row order; itemRow[i] is the row item i came from.
    const items: unknown[] = [];
    const itemRow: Row[] = [];
    for (const row of take) {
      for (const item of spec.toItems ? spec.toItems(row) : [spec.toItem(row)]) {
        items.push(item);
        itemRow.push(row);
      }
    }
    const errors: { id: string; message: string }[] = [];
    if (items.length) {
      const out = await runBatch(ws.workspaceId, items, spec.schema, spec.handle, { label: `feed:${feed}`, bulk: spec.bulk });
      result.created += out.counts.created;
      result.updated += out.counts.updated;
      result.unchanged += out.counts.unchanged;
      for (const r of out.results) if (r.status === "error") errors.push({ id: itemRow[r.index]!.id, message: r.error?.message ?? "Item failed." });
      if (spec.after) {
        const written = out.results.flatMap((r) => (r.status === "error" ? [] : [{ row: itemRow[r.index]!, result: r }]));
        errors.push(...(await spec.after(ws, written)));
      }
    }
    result.read += rows.length;
    result.skipped += rows.length - take.length;
    // A row counts once however many of its items failed.
    result.failed += new Set(errors.map((e) => e.id)).size;

    const last = rows[rows.length - 1]!;
    const firstError = errors[0] ? `${errors[0].id}: ${errors[0].message}` : null;
    await db.query(
      `update crm_brain_feed_cursors
          set last_updated_at = $3::timestamptz, last_id = $4, rows_read = rows_read + $5, rows_failed = rows_failed + $6,
              last_run_at = now(), last_error = coalesce($7, last_error)
        where workspace_id = $1 and feed = $2`,
      [ws.workspaceId, feed, last.cursor_at, last.id, rows.length, new Set(errors.map((e) => e.id)).size, firstError],
    );
    if (rows.length < pageSize) break;
  }
  return result;
}

/** One pass over every taking-part workspace: companies first (people link to them), then people. */
export async function runBrainFeed(opts: { pageSize?: number; log?: (message: string) => void } = {}) {
  const results: { workspace: FeedWorkspace; feeds: FeedRunResult[] }[] = [];
  for (const ws of await feedWorkspaces()) {
    const feeds: FeedRunResult[] = [];
    for (const feed of FEEDS) {
      try {
        feeds.push(await syncFeed(ws, feed, opts));
      } catch (err) {
        // One workspace's failure never stops the others; the bookmark stays where it was.
        console.error(`[brain-feed] workspace ${ws.workspaceId} (${ws.customer}) ${feed} failed:`, err);
        break;
      }
    }
    const moved = feeds.filter((f) => f.read > 0);
    if (moved.length && opts.log) {
      opts.log(`[brain-feed] ${ws.customer}: ${moved.map((f) => `${f.feed} ${f.read} read (${f.created} new, ${f.failed} failed)`).join(", ")}`);
    }
    results.push({ workspace: ws, feeds });
  }
  return results;
}
