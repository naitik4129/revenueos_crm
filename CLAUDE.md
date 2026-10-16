# Northbeam CRM (v2)

## Working rules

- **Plan first, wait for "go".** Propose the step, then stop until the human says go.
- **One small step at a time.** Finish, verify (typecheck + tests), report, stop.
- **No commits or pushes unless told.** No GitHub remote yet.
- **Never discard uncommitted work without asking.** No `git checkout --`, `git restore`, `git reset`, `git clean` or `git stash` on files with uncommitted changes unless the human says so first; commit or copy the files before anything that could overwrite them.
- **Supabase MCP is READ-ONLY.** Only `list_tables`, `list_extensions`, `list_migrations`, `get_project`, `get_project_url`, `search_docs`, and `execute_sql` with `SELECT`. Never `apply_migration`, never INSERT/UPDATE/DELETE/CREATE/ALTER/DROP/GRANT, no branches, edge functions, secrets or storage changes. If unsure whether something writes, don't run it — ask.
- **SQL files are written here; the human runs them** (same as the brain's SQL files).
- **Never touch `public.*` or any schema other than `crm`.** Reading `public.revenueos_profiles` / `public.revenueos_projects` is the only allowed cross-schema access.
- Do not touch the old repo (`../Lead-Managment-System`).

## Goal

A HubSpot-style CRM for MOTM's team, serving many clients. **One workspace = one client project.**
The RevenueOS brain does cold outreach; this CRM holds **all** of a client's data — every prospect company/person the brain finds, its AI calls and email campaign activity — and nurtures the qualified leads (email + WhatsApp via Baileys), through calls, meetings, proposals and won/lost.

This repo is a copy of the old CRM (`Lead-Managment-System`), being reworked. `CONTEXT.md` still describes the OLD system until it is refreshed.

## Decisions (2026-10-16)

### Database
- All CRM tables live in a new Postgres schema **`crm`** in the shared **RevenueOSDatabase** Supabase project (`kiythcbtgvvkxdxwdmok`), also used by the platform and the brain.
- **Fresh start**: no old data migrated, no backfill.
- Backend connects as a dedicated **`crm_app`** role with rights on `crm` only (+ SELECT on `public.revenueos_profiles`, `public.revenueos_projects`). Creating it needs the platform developers' OK first.
- RLS enabled on every `crm` table with **no policies** (backend-only access); `crm` not exposed via the Data API.
- **No citext, no new extensions.** Case-insensitive uniqueness via `lower()` unique indexes. `pgcrypto` is already enabled.
- Storage buckets **`crm-template-attachments`** and **`crm-proposal-documents`** are created by hand in the Supabase dashboard (not by SQL — `storage.buckets` is another schema).

### Users and auth
- Shared Supabase Auth (`auth.users`) with the platform and brain.
- **`crm.profiles`** = `id` (FK `auth.users`, on delete cascade), `role` (admin/salesperson), `is_active`, `created_at`. Name/email are read from `public.revenueos_profiles` (read-only); missing name → show email; initials computed in code.
- **No trigger on `auth.users`**, never write to `public.*`. CRM access = an active `crm.profiles` row; otherwise 403.
- Creating a user with no auth account goes through Supabase Auth admin (the platform's own trigger then creates its `revenueos_profiles` row — accepted). Deactivating only sets `crm.profiles.is_active = false`; never disable/delete the shared auth user.
- **Admins** see and edit everything in every workspace (no membership row needed), manage users, and get **no notifications**. **Only admins** create workspaces and assign members.
- **Salespeople** see only workspaces they are members of (`crm.workspace_members`).

### Data model rules
- One company → many contacts, many deals; everything per workspace.
- **Contact owns consent**: DNC, channel status, merge, "reply stops automation". Every send checks the contact first.
- **Deal owns the sales journey**: stage, outcome (open/won/lost/nurture/discarded), objection, loss reason, owner, meetings, proposals, tasks.
- **Max one open deal per contact per workspace** (partial unique index). `nurture` is **not** open (parked); reopening it is blocked if another deal is open.
- **DNC** keeps the deal open but stops its automation and blocks all sends.
- **Merge** of two contacts that both have an open deal is **blocked**.
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
- **CRM user management**: an email that already has a shared account (found in `public.revenueos_profiles`) only gets a `crm.profiles` row; otherwise the account is created via Supabase Auth admin. The CRM changes only `role` and `is_active`; name, email and password belong to the platform. No `crm.profiles` row → 403 (not 401). Admins cannot deactivate or demote themselves.
- **Test database**: integration tests run on PGlite + pglite-socket (`Backend/tests/integration/testDb.ts`, migrations 000-010 on stand-in `auth`/`public` tables), no Docker. **Single-session limit**: all connections share one PGlite session — an open transaction blocks the others and `SET` leaks between connections — so tests must run sequentially; use a real Postgres if tests ever need concurrent transactions.

### Brain intake (2026-10-16)
- **Mapping**: QuickICP companies → `crm.companies`; QuickICP people → `crm.contacts` (lifecycle `prospect`); Quickhowl AI calls → `crm.calls` with `source = 'ai'`; Email Tool campaign emails → `crm.email_activities`; qualified handover → `crm.deals` (owner assigned).
- **Write path**: the brain writes only through the CRM API `/brain/v1/...` with a per-workspace service key (`crm.brain_api_keys`, SHA-256 hash, shown once). Never direct DB writes. Batches of up to 500, one transaction per item, per-item results, idempotent by external ids.
- **Identity**: `crm.external_refs` maps (source, external id) → company/contact; a contact can have ids from several tools. The brain sends the QuickICP person id with calls and email events. Match order: external ref → email → E.164 phone; a merged contact resolves to its target.
- **Updates fill empty fields only**: brain data never overwrites a non-empty CRM field.
- **Lifecycle stage** (`crm.lifecycle_stage`, like HubSpot): prospect → contacted → engaged → qualified → customer. Set by code, forward only: call or email sent → contacted; email reply or connected call → engaged (opens never count); deal created/handover → qualified; deal won → customer. Admins may move it back manually, with a timeline note.
- **Consent both ways**: email unsubscribe/bounce update the email channel; an AI call flagged DNC puts the contact on DNC. The brain reads `GET /brain/v1/suppressions` before contacting anyone.
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
- Until P7d2 the old leads screens still compile but call the removed `/leads` API; placeholder pages are marked `shortcut:`.

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

Plus `000_platform_grants.sql` (crm_app role; platform developers approve, the human runs it first).

## Open items

- **`crm_app` role**: needs approval from the platform developers before any SQL is run.
- **Google privacy URL**: `/privacy` was removed; Google OAuth consent verification needs a public privacy-policy URL hosted elsewhere (e.g. the marketing site).
- **`brain_customer_key` check**: confirm `revenueos_projects.brain_customer_key` matches the brain's `customer` text (QuickICP tables) before building brain pushes.
- **Retention period** for email reply text, call transcripts and recordings: management decision (no auto-delete in V1).
- **Email Tool results endpoint**: needed before email events beyond `sent` can be pushed.
- **Refresh `CONTEXT.md`** once the `crm` schema and code are in place (it still describes the old system).

## Commands

Backend (`cd Backend`): `npm run typecheck`, `npm run lint`, `npm run test:run` (includes PGlite integration tests), `npm run build`.
Frontend (`cd Frontend`): `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:run`, `npm run build` (the build regenerates `src/routeTree.gen.ts`).
