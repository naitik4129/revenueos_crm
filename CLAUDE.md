# Northbeam CRM (v2)

## Working rules

- **Plan first, wait for "go".** Propose the step, then stop until the human says go.
- **One small step at a time.** Finish, verify (typecheck + tests), report, stop.
- **Commit and push only when the human says so.** Remote `origin` = https://github.com/naitik4129/revenueos_crm.git (private); `main` tracks `origin/main`.
- **Never discard uncommitted work without asking.** No `git checkout --`, `git restore`, `git reset`, `git clean` or `git stash` on files with uncommitted changes unless the human says so first, **even on generated files** (e.g. `Frontend/src/routeTree.gen.ts` changed by a build: ask, don't restore it); commit or copy the files before anything that could overwrite them.
- **Supabase MCP is READ-ONLY.** Only `list_tables`, `list_extensions`, `list_migrations`, `get_project`, `get_project_url`, `search_docs`, and `execute_sql` with `SELECT`. Never `apply_migration`, never INSERT/UPDATE/DELETE/CREATE/ALTER/DROP/GRANT, no branches, edge functions, secrets or storage changes. If unsure whether something writes, don't run it — ask.
- **SQL files are written here; the human runs them** (same as the brain's SQL files).
- **Never touch `public.*` or any schema other than `crm`.** Reading `public.revenueos_profiles` / `public.revenueos_projects` is the only allowed cross-schema access.
- Do not touch the old repo (`../Lead-Managment-System`).

## Goal

A HubSpot-style CRM for MOTM's team, serving many clients. **One workspace = one client project.**
The RevenueOS brain does cold outreach; this CRM holds **all** of a client's data — every prospect company/person the brain finds, its AI calls and email campaign activity — and nurtures the qualified leads (email + WhatsApp via Baileys), through calls, meetings, proposals and won/lost.

This repo is a copy of the old CRM (`Lead-Managment-System`), reworked. `CONTEXT.md` describes the v2 system as it is (refreshed 2026-10-16); this file holds the rules and decisions.

## Decisions (2026-10-16)

### Database
- All CRM tables live in a new Postgres schema **`crm`** in the shared **RevenueOSDatabase** Supabase project (`kiythcbtgvvkxdxwdmok`), also used by the platform and the brain.
- **Fresh start**: no old data migrated, no backfill.
- Backend connects as a dedicated **`crm_app`** role with rights on `crm` only (+ SELECT on `public.revenueos_profiles`, `public.revenueos_projects`). Creating it needs the platform developers' OK first.
- RLS enabled on every `crm` table with **no policies** (backend-only access); `crm` not exposed via the Data API.
- **No citext, no new extensions.** Case-insensitive uniqueness via `lower()` unique indexes. `pgcrypto` is already enabled.
- Storage buckets **`crm-template-attachments`** and **`crm-proposal-documents`** are created by hand in the Supabase dashboard (not by SQL — `storage.buckets` is another schema).
- **Supabase facts** (read via MCP, 2026-10-19): Postgres **17.11** (engine 17), region **ap-south-1** (Mumbai) → host the backend and worker in Mumbai. `max_connections` **60** (3 reserved), **20 already in use** by the platform/brain/Supabase services; `shared_buffers` 256 MB, `work_mem` 3.5 MB, `statement_timeout` 2 min (looks like Micro compute). Pooler (Supavisor) client limit per Supabase's compute table is **200** for Micro; the **pool size** is a dashboard setting (Database settings → Connection pooling) the MCP can't read; the human checks it. `crm` schema not created yet.
- **Connection budget** (step 5, 2026-10-21): ~37 of the 60 are free. Each process has its own pool: **API `DB_POOL_MAX` = 10**, **worker `WORKER_DB_POOL_MAX` = 4** (env, max 30 each) = **14**, or **28** while a deploy runs old and new side by side; that leaves ~9 for scripts, the demo/load tools and the platform's growth. `DATABASE_URL` uses the pooler on port 5432 (session mode), so every pooled client holds a server connection: the pooler's **pool size** in the dashboard must be at least 28 (the human checks it). Raise a pool only with this budget in mind. API: waits **5 s** for a free connection, then **503** `service_unavailable` + `Retry-After: 5`; worker waits 30 s (nobody waits on it). Every connection sets **`statement_timeout` 15 s** (a cancelled statement is also 503). The worker marks its process (`src/workerProcess.ts`, imported first by `worker.ts`) so `db.ts` picks the worker's size and timeout. Installed extensions: `pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `supabase_vault`, `plpgsql`. **`pg_trgm` is available but not installed**; using it would break the "no new extensions" rule, so it needs the human's and the platform developers' OK.

### Users and auth
- Shared Supabase Auth (`auth.users`) with the platform and brain.
- **`crm.profiles`** = `id` (FK `auth.users`, on delete cascade), `role` (admin/salesperson), `is_active`, `created_at`. Name/email are read from `public.revenueos_profiles` (read-only); missing name → show email; initials computed in code.
- **No trigger on `auth.users`**, never write to `public.*`. CRM access = an active `crm.profiles` row; otherwise 403.
- **The CRM never creates auth users.** Adding a user = an existing RevenueOS account (found in `public.revenueos_profiles`) gets a `crm.profiles` row; accounts are created on the platform. Deactivating only sets `crm.profiles.is_active = false`; never disable/delete the shared auth user.
- **Admins** see and edit everything in every workspace (no membership row needed), manage users, and get **no notifications**. **Only admins** create workspaces and assign members.
- **Salespeople** see only workspaces they are members of (`crm.workspace_members`).

### Data model rules
- One company → many contacts, many deals; everything per workspace.
- **Contact owns consent**: DNC, channel status, merge, "reply stops automation". Every send checks the contact first.
- **Deal owns the sales journey**: stage, outcome (open/won/lost/nurture/discarded), objection, loss reason, owner, meetings, proposals, tasks.
- **Max one open deal per contact per workspace** (partial unique index). `nurture` is **not** open (parked); reopening it is blocked if another deal is open.
- **DNC** keeps the deal open but stops its automation and blocks all sends.
- **Merge** of two contacts that both have an open deal is **blocked**.
- **Last activity** (`last_activity_at`) moves on real activity and on field edits that actually change something; assigning an owner (contacts, deals; single or bulk) and setting a deal amount do not (gap 5, 2026-10-19).
- `crm.workspaces.platform_project_id uuid` refers to `public.revenueos_projects.id` — **no FK** (backend checks existence); nullable, unique.
- `external_source` / `external_id` are **text** (brain ids are bigint) — room for the brain to push companies, contacts, calls/emails and handovers later.
- **No tickets.**
- Removed: website lead intake (`/public/leads`, `INGEST_*`), `/privacy` page, retired enum values (`maybe`, `negative`, `maybe_nurture`, `negative_nurture`, `call_outcome_maybe`, `call_outcome_negative`), `lead_source = 'website'`.
- Leak fixes: `notifications.workspace_id` NOT NULL; default meeting-scheduled templates are per-workspace columns on `crm.workspaces` (not global flags on templates).

### Backend rework rules (2026-10-16)
- Phases: P0 PGlite test DB → P1 auth/workspaces → P2a migration 011 → P2 companies/contacts/deals → P2b brain intake API → P3 calls/tasks/meetings/proposals → P4 automation/worker → P5 WhatsApp/email/calendar → P6 dashboard/notifications → P7 frontend. One phase per "go".
- **Call with no open deal**: the call is always saved. If the outcome moves the pipeline and the contact has no open deal, reopen its `nurture` deal if one exists, else create a new open deal, then route. Contact-level outcomes (DNC, wrong number) never create a deal.
- **Merge + DNC**: if either contact is DNC, the target becomes DNC. Merge moves deals first, then tasks' `contact_id`; blocked if both have an open deal.
- **Template variables**: `{{contact.*}}`, `{{company.*}}`, `{{deal.*}}`; no aliases for the old `{{lead.*}}` names.
- **CRM user management** (changed in P7f): `POST /admin/users` takes email + role only; an email with a shared account (found in `public.revenueos_profiles`) gets a `crm.profiles` row, an unknown email is refused ("No RevenueOS account with this email — create it on the platform first."). The CRM changes only `role` and `is_active`; name, email and password belong to the platform. No `crm.profiles` row → 403 (not 401). Admins cannot deactivate or demote themselves.
- **Test database**: integration tests run on PGlite + pglite-socket (`Backend/tests/integration/testDb.ts`, migrations 000-010 on stand-in `auth`/`public` tables), no Docker. **Single-session limit**: all connections share one PGlite session — an open transaction blocks the others and `SET` leaks between connections — so tests must run sequentially; use a real Postgres if tests ever need concurrent transactions.

### Brain intake (2026-10-16)
- **Mapping**: QuickICP companies → `crm.companies`; QuickICP people → `crm.contacts` (lifecycle `prospect`); Quickhowl AI calls → `crm.calls` with `source = 'ai'`; Email Tool campaign emails → `crm.email_activities`; qualified handover → `crm.deals` (owner assigned).
- **Write path**: the brain writes only through the CRM API `/brain/v1/...` with a per-workspace service key (`crm.brain_api_keys`, SHA-256 hash, shown once). Never direct DB writes. Batches of up to 500, per-item results, idempotent by external ids.
- **Batch writes** (changed 2026-10-21): companies, contacts, calls and email-events are written **set-based**, one transaction per batch under a per-workspace advisory lock (`brain-bulk.service.ts`): read what's needed in a few queries (matched contacts/companies locked `FOR UPDATE`), decide every item in order in code exactly as one-at-a-time would (a later item sees what an earlier one created or filled; merged contacts resolve to their target), write in a few statements. A decided problem (unknown contact) is only that item's error. A unique clash or deadlock retries the batch once; any other DB error, or a second failure, **falls back to one transaction per item** (the old handlers in `brain.service.ts`, still the source of the rules) and logs `[brain] Batch fell back to one transaction per item: N <route> item(s), workspace …, reason`. Handovers stay per item, 4 at a time; handovers naming the same person run one after another.
- **Brain contract** (what the brain team must do): (a) read the **full** `/suppressions` list (no cursor) right before every call or email campaign; the cursor feed is only for updates in between; (b) send **handovers in batches of at most 50** (enforced: more is 400 "At most 50 items per request."); (c) other routes: **500 items per batch** recommended (the maximum), request body at most **25 MB**, so split by bytes as well when call transcripts are big.
- **Identity**: `crm.external_refs` maps (source, external id) → company/contact; a contact can have ids from several tools. The brain sends the QuickICP person id with calls and email events. Match order: external ref → email → E.164 phone; a merged contact resolves to its target.
- **Updates fill empty fields only**: brain data never overwrites a non-empty CRM field.
- **Lifecycle stage** (`crm.lifecycle_stage`, like HubSpot): prospect → contacted → engaged → qualified → customer. Set by code, forward only: call or email sent → contacted; email reply or connected call → engaged (opens never count); deal created/handover → qualified; deal won → customer. Admins may move it back manually, with a timeline note.
- **Consent both ways**: email unsubscribe/bounce update the email channel; an AI call flagged DNC puts the contact on DNC. The brain reads `GET /brain/v1/suppressions` before contacting anyone.
- **Suppressions feed contract** (changed 2026-10-21; brain-facing): `GET /brain/v1/suppressions?limit=` (default 1000, max 5000) returns `{ data, next, hasMore }`. **`nextSince` is gone.** The brain keeps `next` (an opaque string; never parse or build it) and sends it back as `?cursor=` until `hasMore` is false, then keeps polling with its latest `next`. No cursor = the full current list (contacts with a block); when it runs out, `next` carries on as the change feed from that point, so the brain syncs once and then only gets changes, lifts included (status `lifted`). `?since=<ISO time>` (exclusive) starts a change feed at a time; `since` with `cursor` is 400, a cursor the CRM did not issue is 400. Order and cursor are (changed_at, contact id) at microsecond precision: rows sharing one timestamp (a bulk change) come exactly once each and the cursor always moves. `changedAt` / `liftedAt` are UTC ISO with 6 fractional digits. Every branch filters by workspace first; migration 014a indexes the time columns. Known limit: a change committed by a transaction that started before the brain's last poll carries an older timestamp and can fall behind the cursor; a periodic full resync (no cursor) covers it.
- **AI calls are activity only**: no human call routing; qualification comes only through `/brain/v1/handovers`.
- **Handover owner**: `ownerEmail` if that user is a member of the workspace, else `crm.workspaces.default_owner_id`, else unassigned + notify all members.
- **Volume**: ~150-200 companies and 250-350 contacts per client per month. Batch size 500; all lists paginated.
- **Personal data**: email reply text and call transcripts are stored in full; no auto-delete in V1.
- **Fresh start** = no old CRM data; a one-time QuickICP push later through the same API is allowed.
- **Email events beyond `sent`** (delivered, opened, replied, bounced, unsubscribed) wait for the Email Tool results endpoint.
- Workflow trigger `lead_created` is renamed `deal_created`: prospects never auto-enroll; only deals do.

### P7 frontend rework (2026-10-16)
- Sub-phases, one per "go", each passing typecheck/lint/format:check/tests/build and committed: **P7a** foundation (types + API client beside the old ones, workspace switcher, nav, dashboard) → **P7b** contacts → **P7c** companies → **P7d1** deals pipeline board → **P7d2** deal detail + delete `features/leads/`, the leads routes and `types/lead.ts` → **P7e** tasks/meetings/proposals/runs pages + notifications bell → **P7f** admin (users, workspaces, members, brain API keys) → **P7g** template variable picker (`{{contact.*}}`/`{{company.*}}`/`{{deal.*}}`) → then refresh `CONTEXT.md` as its own step.
- Deals board: native HTML5 drag-and-drop plus a stage dropdown on each card; **no new library**.
- `deals.closed_at` (012) is set whenever the outcome leaves `open`, so a nurture deal later won moves to the win date; cleared on reopen.
- Overdue = due before the start of today (Asia/Kolkata); never overlaps "due today" (dashboard and the tasks list agree).
- Admins use the whole app (all workspaces) plus `/admin`; only admins see "Create workspace". A user with no workspace sees an empty state; a saved workspace id that is no longer allowed is dropped.
- P7d2 removed the old leads code (`features/leads/`, leads routes, `types/lead.ts`). Proposals are created and sent in steps (create → upload document → send); call and meeting tasks on the Tasks page open their deal.

### P7f admin (2026-10-16)
- `/admin` has four tabs: Users, Workspaces, Members, Brain API keys. Admin-only: the nav item is hidden for salespeople and `/admin` redirects them home (`lib/admin-gate.ts`); backend checks stay the source of truth.
- The Google Calendar OAuth landing `/admin?calendar=…` is forwarded to `/settings` for every role (tested in `admin-gate.test.ts`).
- **Default owner** (`workspaces.default_owner_id`): set by admins only (`PATCH /workspaces/:id`), must be an active salesperson member; removing that member clears it. Settings shows it read-only to salespeople.
- **Default meeting templates** and the settings connections stay editable by any member, as before.
- Platform project id is pasted (checked in code against `revenueos_projects`); no project picker.
- A brain key's full value is shown once, in the create dialog; lists show only the prefix.

### P7g template variables (2026-10-16)
- One list: `TEMPLATE_VARIABLES` in `Backend/src/domain/templateRenderer.ts` (token, label, group contact/company/deal/meeting/date). The frontend picker reads it from `GET /templates/variables`; there is no frontend copy.
- `POST /templates/preview` renders unsaved text against a deal or a contact. A contact previews as its open deal; with none, `deal.*` stay unfilled. `meeting.*` use the deal's latest meeting. Unfilled tokens stay as `{{...}}`, highlighted and listed as unknown / needs a deal / needs a meeting.

### P7h server paging (2026-10-16)
- Meetings, proposals, runs and scheduled-actions lists are paged on the server like tasks: `limit` (default 50, max 500) + `offset`, response `{ data, total, limit, offset }`.
- Meetings: `when` = `upcoming` (from the start of today, Asia/Kolkata, soonest first) / `past` (before it, latest first) / `today`. The page has Upcoming / Past tabs; the Today card is its own `when=today` query.
- Proposals: stat cards come from `GET /proposals/summary` (whole workspace: open, awaiting decision, value in play).
- Runs and scheduled actions: `search` (contact or company name) runs on the server.
- **Owner filter** (gap 1, 2026-10-19): `GET /contacts`, `/companies`, `/deals` take `ownerId` = a user id or `none` (no owner). Each list has an "Unassigned" view tab and an "Unassigned" Owner option; on Deals both the board and the list.
- **Has open deal** (gap 2, 2026-10-19): `GET /contacts?hasOpenDeal=true|false` (anything else 400); a nurture deal is not open. Contacts has a "With open deal" view tab.
- **Sorting** (gaps 3, 12, 2026-10-19): `GET /contacts`, `/companies`, `/deals` take `sort` = a fixed key, or `-key` for descending; anything else is 400. Keys: contacts `name`, `company`, `lastActivity`, `created`; companies `name`, `contacts`, `openDeals`, `created`; deals `name`, `amount`, `lastActivity`, `created`, `closed`. Names sort case-insensitively, empty values last in both directions, ties broken by id (stable paging); no `sort` keeps each list's default order (`orderBySql` in `dto.ts`, `*_SORTS` in the services). The UI sorts from column headers (▲/▼; click again to reverse), goes back to page 1, and remembers the sort per list in the browser like the columns; the deals board keeps its own order.
- **Status counts** (gaps 14, 17, 2026-10-19): `GET /proposals` and `GET /runs` also return `statusCounts` (`{ status: n }`, statuses with no rows left out) under the same filters as the list except `status` (runs: search included), so every tab shows its number whichever tab is open. Tabs read "Sent (4)"; "All" is the sum; no number while loading (`tabLabel` in `lib/format.ts`).
- **Deal page**: uses deal-filtered, unpaged calls (`/deals/:id/meetings|proposals|runs`, `/scheduled-actions?dealId=`); never the paged workspace lists. `useAutomations()` no longer loads runs or scheduled actions.

### Workflow templates (gap 18, 2026-10-19)
- **Drafts** may save a send step (email/WhatsApp) without a template; **publishing** refuses it ("Step N (send_email) requires a template.").
- **Guards** (`templateUsage` in `workflows.service.ts`): a template used by a workflow's live version, or by any version a run is still on (running / waiting / paused), can't be deleted or switched off — 409 naming the workflows. One kept only by an earlier published version can be switched off but not deleted: published steps never change (trigger `workflow_steps_draft_only_edit`), so the DB refuses it too; the API says so instead of a 500. A template only drafts use can be deleted.
- **Safety net**: if a send still finds its template missing or inactive, the worker skips it (action `skipped`, timeline note), the run moves on, and `notifyOwnerOrMembers` warns the deal owner — with no owner, every active salesperson member; admins never (same rule as handovers): "Workflow X skipped a send: template missing/inactive".

### Small gaps pass decisions (2026-10-19)
**Paused after step 1** (gap 2, commit `549f98e`) for the scale + sending safety pass below; resume at step 2 when that pass is done.
Steps, one per "go": 1 gap 2 (has open deal) → 2 gap 7 (meetings by contact) → 3 gap 10 (tasks by company; done in scale step 7) → 4 gap 9 (last contacted / next task due) → 5 gap 14 rest (proposal status groups) → 6 gaps 15, 16 (one definition each) → 7 gap 6 half (log a hand-sent email/WhatsApp from the record page). No migrations.
- **Last contacted** = the latest outgoing contact: a call (human or AI, any outcome); a campaign email sent by the brain (`email_activities.sent_at`); an email or WhatsApp sent by a workflow or logged by hand. The last two are timeline events matched on `event_kind` in (`email`, `whatsapp`) **and** `actor_source` in (`automation`, `user`) — kind alone also covers incoming WhatsApp replies (`system`) and brain email events (`brain`). Dry-run sends are excluded by `metadata.dryRun = true`, which the worker sets from now on (nothing has run in production, so no old events need it). No title matching. Replies, notes and field edits don't count.
- **Next task due** = the earliest open task for the contact, on the contact or any of its deals; red when overdue.
- **Proposal tab groups**: All · In progress (draft, uploaded, ready to send, **revised**) · Awaiting decision (sent, revision requested) · Accepted · Lost (rejected, withdrawn, expired). `revised` is In progress because delivering a proposal on any channel moves it to `sent` (`proposalSending.service.ts`), so a `revised` proposal is always one still to be sent; once re-sent it is `sent` and counts as Awaiting decision.
- **"Awaiting decision"** (dashboard card, `GET /proposals/summary`, the tab) = sent + revision requested, everywhere.
- **"Meetings today"** = today's meetings that are not cancelled or failed, everywhere (dashboard card and `GET /meetings?when=today`); they still show under Upcoming.
- **Step 7**: the record page's Email action logs the send through `POST /contacts/:id/communications` and still opens the mail app (`mailto:`).

### Scale + sending safety pass (2026-10-19)
Goal: the CRM ready for the brain at **10-15k leads per workspace**, with safe sending. Targets: every API request **under 1 s (p95)**, a brain batch of 500 **under 5 s**.

**Mailboxes**: brain cold email (Email Tool) and CRM nurture email **must use different mailboxes** (and ideally different sending domains), so cold-outreach bounces/complaints never hurt nurture deliverability. A setup rule for each workspace's email connection (not enforced in code).

**Scale audit** (read from code, not measured; the load test confirms):
| # | Where | Problem | Fix | Size |
|---|---|---|---|---|
| 1 | `brain.service.ts` `runBatch` | 500 items run one after another, one transaction each (~8-12 queries) ≈ 5k round trips: ~5 s at 1 ms, ~100 s at 20 ms; holds 1 of 10 pool connections throughout | Items 6-8 at a time; retry once on unique clash (same email twice in a batch); backend in Mumbai | M |
| 2 | `db.ts` pool | `max: 10`, no `connectionTimeoutMillis`, no `statement_timeout`: a busy pool queues forever | Connection timeout → 503, statement timeout ~15 s, pool size from env; budget against the 60 max connections | S |
| 3 | `deals-page.tsx` `BOARD_LIMIT`, `board.ts` | Board loads 500 of 5k open deals: columns and totals **wrong** (known `shortcut:`) | `GET /deals/board-summary` (count + amount per stage); each column pages itself ("load more") | M |
| 4 | `brain.service.ts` `listSuppressions` | (a) Scans `contact_channels` of **every** workspace; the "lifted" part matches almost every channel row. (b) **Wrong results**: cursor `> since` on `changed_at` skips ties at a page edge (a bulk DNC in one transaction gives every row the same `now()`) | Filter by workspace first (join contacts); cursor `(changed_at, contact_id)` as an opaque `next`; index `dnc_events (action, created_at)` | M |
| 5 | `contacts.routes.ts` `/import`, `importContacts` | Up to 2000 rows in one transaction, row by row: minutes on a remote DB, long locks, HTTP timeouts | Client splits into chunks of 500, one request each (all-or-nothing per chunk), progress bar; server set-based | M |
| 6 | `dashboard.service.ts` | Counts on `calls`, `email_activities` have no `(workspace_id, date)` index: whole-table scans across all clients | Migration 014 indexes: `calls (workspace_id, occurred_at)`, `email_activities (workspace_id, sent_at)`, `(workspace_id, replied_at) where replied_at is not null`. Live counts stay (no cache) | S |
| 7 | `listContacts` / `listDeals` / `listCompanies` | `count(*) over()` builds and sorts the whole filtered set (with per-row subqueries) before the 50-row page | Separate count query; plain ORDER BY + LIMIT; indexes `(workspace_id, created_at desc)`, `(workspace_id, last_activity_at desc)` on contacts and deals | M |
| 8 | `companies.service.ts` `COMPANY_SELECT` | Two count subqueries for **every** company before filter/sort/limit (`from (…) co`) | Filter + page first, counts for the page rows; sort by count via one grouped join | S |
| 9 | Search `ilike '%x%'` (contacts, deals, companies) | Whole-workspace scan; fine at 15k (~20-60 ms) | Measure first. Over 300 ms → `pg_trgm` (needs OK, see Supabase facts) or prefix search on `lower(email)`/name | S |
| 10 | `automation.service.ts` `claimDueActionIds` | `or status = 'executing' …` defeats the partial index: full scan of `scheduled_actions` every 10 s, table only grows | Two claims (or UNION) + index `(last_attempt_at) where status = 'executing'` | S |
| 11 | Worker (`WORKER_BATCH_SIZE` 20 / 10 s) | ~7k actions/hour is enough for 5k deals, but the 20 run **in parallel**: bursts with no spacing | Throughput fine; spacing/caps in the sending safety steps | — |
| 12 | Company page (`contact-hooks.ts`) | Contacts/deals capped at 200, timeline at 100, no "load more" | Timeline "load more"; leave the rest | S |
| 13 | Gap 9 (last contacted / next task due), not built | Naively 3-4 subqueries per row over calls, email_activities, timeline_events | Compute for the page rows only, on the existing contact_id indexes | — |
| 14 | `app.ts` brain body limit 25 MB | Batches with long transcripts (up to 500k chars each) can exceed it | Document it; the brain splits by bytes | S |

**Load test plan**
- **DB**: local **native PostgreSQL 17** (same major as Supabase 17.11), not PGlite (single session: no concurrency, unrealistic timings). Reuses `testDb.ts`'s stand-in `auth`/`public` tables + migrations 000-013, pointed at `LOAD_DB_URL`. Remote latency simulated in the harness (~15 ms per query, a wrapper around `pg`), so no extra tool. Optional later: one run against a Supabase staging branch the human creates.
- **Seed** (`Backend/load/seed.ts`, never built or shipped, like `demo/`): 3 workspaces, one full size (15k contacts, 15k companies, 5k open + 3k closed deals, 100k activity rows over calls / email_activities / timeline / tasks / notes, 2k scheduled actions) and two at 5k (to expose cross-workspace scans). `generate_series` SQL.
- **Runner** (`Backend/load/run.ts`): real app over HTTP, signed in as admin and salesperson, each route 20×, p50/p95, `EXPLAIN (ANALYZE, BUFFERS)` for anything over 300 ms. Covers: lists (contacts/companies/deals with every sort key, search, `ownerId=none`, `hasOpenDeal`, offset page 300; tasks, meetings, proposals, runs, scheduled actions); contact/deal/company pages (every call each makes) + timelines; dashboard + today's queue; brain 30 × 500 per route (companies, contacts, calls, email-events) + 500 handovers, one after another and 3 at a time; `/suppressions` with/without `since` + the tie test; CSV import 2000 rows; mixed: 10 users browsing during a brain batch (pool starvation).
- Results saved as a dated table in `Backend/load/RESULTS.md` (baseline, then after each fix).
- As built (step 1): brain batches = 30 in total (8 companies, 8 contacts, 7 calls, 7 email-events; the last 3 contact batches run at once during the mixed load) + 1 handover batch, all in workspace A after the read benchmarks; Supabase Auth also gets the +15 ms; queries traced by wrapping `pg.Client.prototype.query` from the harness (no app change).

**Bulk actions (gap 4) design**
- `POST /contacts/bulk` `{ action: owner | lifecycle | dnc | delete, ids, ...args }`, **ids only, max 500** (one page; "select all on this page"); no "all matching filter" in v1.
- One transaction per request, per-id results (`ok` / `skipped` + reason); each id goes through the same service function as the single action.
- Owner: active workspace member; does not move last activity; replaces the one-PATCH-per-record loop in `use-bulk-assign.ts` for contacts.
- Lifecycle: forward only for salespeople; moving back is admin-only with a required note → timeline per contact.
- DNC: reason required; same path as single DNC (dnc_events, automation stop, channels). Lifting DNC in bulk: admin-only.
- Delete: admin-only, confirm by typing the count; `deleted_records_audit` per row; contacts with an open deal are skipped unless `force`.
- Audit: one `admin_audit_events` row per request (action, count, ids, actor) + the existing per-record rows. No rate limit in v1.

**Sending safety: today vs missing**
Email (`email.provider.ts`, `automation-runner.ts`):
| Rule | Today | Missing |
|---|---|---|
| Per-mailbox daily cap + warm-up ramp | none | `daily_cap`, `ramp_start`, `ramp_step_per_day`, `ramp_started_at`; count today's (IST) sends before each send, defer when over |
| Random spacing, working hours | none (20 sends in parallel per tick) | `min/max_gap_seconds` + working window (IST, weekdays); outside it defer to the next window |
| Auto-pause on bounce ~3% / complaints + admin alert | **no bounce/complaint feed** (no Resend webhook; SMTP 5xx only fails that send) | Resend webhook (signature checked) → channel `permanent_bounce` / `unsubscribed`; rolling 7-day bounce rate (min 50 sends); over threshold or any complaint → `paused` + reason + notify admins |
| Bounced/unsubscribed never again | yes: `sendBlockReason` blocks `permanent_bounce`, `unsubscribed`, `invalid` before every send; brain bounce/unsubscribe events set the channel | Workflow sends' own bounces (needs the webhook) |
| Unsubscribe link in every email | none | Signed-token link + `List-Unsubscribe` / `List-Unsubscribe-Post` headers; public `/u/:token` sets the channel to `unsubscribed` |
| Address check before send | format only (`normalizeEmail`) | Syntax + MX lookup (Node `dns`, cached per domain); no MX → channel `invalid` |

WhatsApp (Baileys, `baileys.manager.ts` claim):
| Rule | Today | Missing |
|---|---|---|
| Engaged only, never cold | partly: only deals enroll (prospects never), but a hand-made deal can be cold | Gate: inbound WhatsApp reply, connected call, or an `opt_in` on the WhatsApp channel; else skip + log |
| Per-number daily cap + ramp | `daily_cap` (default 200), no ramp | Ramp like email; lower default for new numbers |
| Random gaps | yes: `min/max_delay_seconds` (5-15 s) | Defaults to ~45-120 s |
| Working hours | none | Same window settings as email |
| Auto-pause on failures/blocks/disconnect | emergency switch; WhatsApp reachout/new-chat restriction defers; disconnected = no sends | Daily failure/block counter → auto-pause + admin alert; terminal disconnect (logout) → pause + alert |
| "STOP" reply = DNC | none (message text is not read; body never stored) | Check inbound text **at receive time** for STOP / UNSUBSCRIBE / "band karo" (still not stored) → WhatsApp channel `opted_out` + timeline |

All channels: limits per workspace in a new `crm.send_policies` (one row per workspace × channel; migration 015), admin-editable in a new `/admin` "Sending" tab; enforced in the worker inside the claim before every provider call (pause → hours → cap/ramp → gap → consent); every block/deferral logged with its reason on the action (timeline when skipped). Shared stop list with the brain = `/suppressions` (DNC + blocked channels, incl. WhatsApp `opted_out` from STOP), after fix 4.

**Order** (one step per "go"; re-measure with the harness after each scale step; reordered 2026-10-21 after the baseline):
1. Load test harness + seed + **baseline** measurement (`RESULTS.md`). Done (`4f0352a`).
2. Suppressions: workspace filter + exact cursor (item 4 + the ms/µs bug), migration 014a. Done (`ae186b2`).
3. Brain batch speed: set-based SQL per batch (item 1); handovers with limited concurrency. Done: 500 items in 0.4-0.6 s (9-12 SQL) for companies/contacts/calls/email-events; handovers 500 in ~120 s (4 at a time), so ~12 s per batch of 50.
4. Handover cap (50, enforced) + CSV import chunks (item 5). Done: the client (`importInChunks`) sends 500 rows per request (server max 500), one after another, progress bar; a failed chunk and the rest are listed as "Not imported: …", earlier chunks stay. Server set-based like brain-bulk: one read for duplicates, one for companies, one insert each for companies, contacts and their timeline (`insertTimelineRows` in `timeline.service.ts`, shared with brain-bulk), under the brain's per-workspace lock; rows asking for a deal still go through `createDeal` one by one. Across chunks a repeat of an earlier chunk's row reads "Matches an existing contact" (that chunk is already saved).
5. Migration 014 (indexes: items 6, 7, 10) + pool timeouts (item 2); re-measure. Done: `014_crm_scale_indexes.sql` (written, not run yet); the worker claims due and stuck actions in two locked CTEs, one per partial index; pool budget above.
6. List counts + company counts (items 7, 8). Done: contacts, companies and deals lists use `pageOf` (`dto.ts`): ids paged first (cheap columns, ORDER BY + LIMIT/OFFSET), then the full select for those rows only, kept in that order; the total is a separate `count(*)` run alongside (two pool connections for a moment). Companies: filters read `companies` only, the two count subqueries run for the page rows only; sorting by a count joins one grouped count (`COUNT_JOINS`). Deals join the next-task lateral only for `missingNextAction`. `listPaging.test.ts` pages every sort key both ways and the main filters 7 rows at a time against the old one-query lists: same rows, order, totals, counts.
7. Deals board summary + column paging (item 3), parallel page loads. Done: `GET /deals/board-summary` (`ownerId`, `missingNextAction`, `search`, `perStage` 0-50) = count + amount per stage over every open deal, all 15 stages in order, and with `perStage` each stage's first deals (the list's default order). The board loads in **one request** (`perStage=20`): a first try with the summary plus 15 column requests at once put the 10-user mixed load at p95 1.9 s (pool queueing), so don't split it again. A column's own query (`/deals?outcome=open&stage=…` from offset 20, 20 at a time) starts at its first "Load more"; headers come from the summary, with moves still being saved applied until the summary is refetched (`stageHeaders`); the 500-deal limit is gone. Record pages load in one round: `GET /deals/:id/related` (contact, the contact's notes, company), `GET /contacts/:id/related` (company, the open deal's meetings), `GET /tasks?companyId=` (tasks on the company's deals or its contacts; replaces the first-10-deals shortcut, gap 10 done). `missingNextAction` is now `not exists` an open task (same rows as the next-task join).
8. Bulk contacts endpoint + UI (gap 4). Done: `POST /contacts/bulk` (`runContactBulk`), as designed above. Each action is one set-based function over a list of ids (`assignContactOwners`, `setLifecycleStageMany`, `markDncMany`, `reactivateFromDncMany`, `deleteContactsMany`: lock in id order, decide per id, write in a few statements) and the **single actions are those functions with one id**, so both follow the same rules (500 per-id service calls would take ~30 s at 15 ms a round trip). Per id `ok`, or `skipped` + reason (already so, not found, merged, not allowed, open deal). Request-level checks: owner = active member (the single PATCH does not check this), lifting DNC and delete admin-only, delete `confirm` = the count. One `admin_audit_events` row per request (`contacts.bulk.<action>`). UI: bulk bar on the contacts page (Assign owner now one request; Lifecycle, Do Not Contact, admin Lift DNC and Delete with typed count + force), skipped list with names and reasons. Companies and deals still assign owners one PATCH each (`use-bulk-assign.ts`). Load: 500 ids per action 0.35-0.5 s, delete with force 1.6 s.
9. Migration 015 send policies + worker enforcement (caps, ramp, hours, gaps, pause).
10. Resend webhook, bounce/complaint auto-pause, unsubscribe link + headers, MX check.
11. WhatsApp engaged-only gate, STOP → opted out, failure auto-pause.
12. Admin "Sending" tab.

### Kept features
CSV import, calls + routing, nurture workflows + worker, templates + attachments, email (Resend/SMTP), WhatsApp (Baileys), Google Calendar, meetings, proposals, tasks, DNC, merge, delete + audit, notifications, dashboard, workspaces, admin users.

## Tables (35, all in `crm`)

Identity
1. `profiles` — CRM access record (role, is_active).
2. `workspaces` — one per client project; platform_project_id, default meeting templates.
3. `workspace_members` — (workspace_id, user_id) PK.

Core
4. `companies` — name, domain, website, industry, phone, city, country, owner, source, external_*; unique (workspace, lower(domain)).
5. `contacts` — person + consent; status active/do_not_contact/merged; unique (workspace, lower(email)) and (workspace, phone_e164).
6. `contact_channels` — per-channel status (phone/email/whatsapp).
7. `dnc_events` — DNC history per contact.
8. `deals` — stage, outcome, automation, response state, objection, interested-later fields, loss reason, owner; one open deal per contact.

Activity
9. `notes` — contact, optional deal.
10. `calls` — contact, optional deal.
11. `tasks` — optional deal and/or contact.
12. `meetings` — deal; calendar sync and notification send status.
13. `meeting_participants`
14. `proposals` — deal; document, send status, loss fields.
15. `timeline_events` — optional company/contact/deal; actor source user/system/brain.
16. `notifications` — workspace required.

Automation
17. `message_templates`
18. `template_attachments`
19. `workflows`
20. `workflow_versions`
21. `workflow_steps`
22. `workflow_runs` — deal, with contact copied.
23. `scheduled_actions`

Integrations (per workspace)
24. `integration_connections` (email)
25. `google_calendar_connection`
26. `whatsapp_connection`
27. `whatsapp_auth_credentials`
28. `whatsapp_auth_keys`
29. `whatsapp_outbound_messages` — contact.
30. `whatsapp_inbound_events` — contact.

Audit
31. `deleted_records_audit` — with entity type.
32. `admin_audit_events`

Brain intake (011)
33. `external_refs` — (source, external id) → company or contact.
34. `email_activities` — one row per campaign email per contact; status = highest event so far.
35. `brain_api_keys` — per-workspace service keys (hash only).

011 also adds `contacts.lifecycle_stage` (+ linkedin_url, country, location), `companies.headcount/linkedin_url/location`, AI-call fields on `calls`, `workspaces.default_owner_id`, and drops `external_source/external_id` from companies and contacts (replaced by `external_refs`).

Enums live in `crm` too.

## SQL files to write (in order, in `Supabase/migrations/`)

1. `001_crm_schema.sql` — schema, revoke from anon/authenticated, grants to `crm_app`.
2. `002_crm_enums.sql` — all enum types.
3. `003_crm_identity.sql` — profiles, workspaces, workspace_members.
4. `004_crm_core.sql` — companies, contacts, contact_channels, dnc_events, deals + unique indexes.
5. `005_crm_activity.sql` — notes, calls, tasks, meetings + participants, proposals, timeline, notifications.
6. `006_crm_automation.sql` — templates + attachments, workflow tables, scheduled_actions, workspace → default template FKs.
7. `007_crm_integrations.sql` — email, Google Calendar, WhatsApp tables.
8. `008_crm_audit.sql` — deleted_records_audit, admin_audit_events.
9. `009_crm_triggers.sql` — updated_at, DNC history, consent/automation stop, deal outcome cascade.
10. `010_crm_rls.sql` — enable RLS on all crm tables, no policies.
11. `011_crm_brain_intake.sql` — lifecycle stage, external refs, AI calls, email activities, brain API keys, default owner.
12. `012_crm_deal_closed_at.sql` — `deals.closed_at`, set by trigger when the outcome leaves `open`, cleared on reopen.
13. `013_crm_deal_amount.sql` — `deals.amount` (numeric, ≥ 0, nullable) + `currency` (INR only, by check); the brain handover's `amount` fills an empty one.
14. `014_crm_scale_indexes.sql` — scale indexes: `calls (workspace_id, occurred_at)`, `email_activities (workspace_id, sent_at)` and `(workspace_id, replied_at)` where replied, contacts and deals `(workspace_id, created_at desc)` and `(workspace_id, last_activity_at desc)`, `scheduled_actions (last_attempt_at) where status = 'executing'`. Indexes only; written, not run yet.
15. `014a_crm_suppressions_indexes.sql` — indexes for the suppressions change feed: `contact_channels (updated_at)`, `dnc_events (created_at) where action = 'reactivated'`. Indexes only; written, not run yet.

Plus `000_platform_grants.sql` (crm_app role; platform developers approve, the human runs it first).

## Open items

- **`crm_app` role**: needs approval from the platform developers before any SQL is run.
- **Google privacy URL**: `/privacy` was removed; Google OAuth consent verification needs a public privacy-policy URL hosted elsewhere (e.g. the marketing site).
- **`brain_customer_key` check**: confirm `revenueos_projects.brain_customer_key` matches the brain's `customer` text (QuickICP tables) before building brain pushes.
- **Retention period** for email reply text, call transcripts and recordings: management decision (no auto-delete in V1).
- **Email Tool results endpoint**: needed before email events beyond `sent` can be pushed.
- **API gaps found by the UI redesign** (branch `ui-redesign`, frontend only; listed, not built):
  4. ~~Bulk endpoints for contacts~~ done in scale step 8 (`POST /contacts/bulk`).
  6. Send or log a one-off email from a record (the record page uses `mailto:` until then).
  7. Meetings by contact (meetings filter only by deal).
  8. Saved views stored on the server (custom or shared per team).
  9. Contacts list columns "last contacted" and "next task due".
  10. ~~Tasks by company~~ done in scale step 7 (`GET /tasks?companyId=`).
  11. Notes on a company (notes exist only on contacts and deals).
  14. Proposals list: a multi-status filter (e.g. "in progress" = draft + uploaded + ready to send + revised); it filters one status at a time. (The per-status counts are done.)
  15. "Proposals awaiting decision" means two things: the dashboard counts sent + revision requested + revised, `GET /proposals/summary` counts sent only. The dashboard card opens the Sent tab, so its list can be shorter than the card.
  16. "Meetings today" on the dashboard leaves out cancelled/failed meetings; `GET /meetings?when=today` lists every status. A status filter on the meetings list (or one shared definition) would make the card and the Today tab agree.

## Demo mode (2026-10-16)
`cd Backend && npm run demo` -> http://127.0.0.1:8080, users admin@/sam@/priya@demo.local (password `demo`). Local PGlite + seed + fake Supabase Auth/Storage + API + dry-run worker + Vite, all in one process. Code lives in `Backend/demo/` (never built or shipped); guards and tests are described in `Backend/README.md`. No demo code in `Backend/src`.

## Commands

Backend (`cd Backend`): `npm run typecheck` (also typechecks `demo/` and `load/`), `npm run lint`, `npm run test:run` (includes PGlite integration tests and the demo/load guard tests), `npm run build`, `npm run demo`, `npm run load` (load test: rebuilds + seeds the local `crm_load` database named by `LOAD_DB_URL` in `Backend/.env`, refuses any other host or database, ~1.5 h, writes `load/RESULTS.md`; code in `Backend/load/`, never built or shipped). Quick re-measure: `npm run load -- --only <area>` with `suppressions`, `brain-companies`, `brain-contacts`, `brain-calls`, `brain-email`, `brain-handovers`, `csv`, `mixed` (10 users browsing for 60 s while contact batches run 3 at a time, round after round) `reads` (the baseline's slowest reads: record pages, last list pages, dashboard) `bulk` (each bulk contact action on 500 ids), `board` (the deals board old and new, the record pages old and in one round) or `lists` (every sort key, default order and last page of contacts/companies/deals, and the company page); several at once with commas, e.g. `--only lists,mixed` (same seed, that area only, brain areas run 3 batches; appends a section to `RESULTS.md`). The run stops if the app pool's live `statement_timeout` is not 15 s.
Frontend (`cd Frontend`): `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:run`, `npm run build` (the build regenerates `src/routeTree.gen.ts`).
