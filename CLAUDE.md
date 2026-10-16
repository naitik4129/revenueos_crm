# Northbeam CRM (v2)

## Working rules

- **Plan first, wait for "go".** Propose the step, then stop until the human says go.
- **One small step at a time.** Finish, verify (typecheck + tests), report, stop.
- **No commits or pushes unless told.** No GitHub remote yet.
- **Supabase MCP is READ-ONLY.** Only `list_tables`, `list_extensions`, `list_migrations`, `get_project`, `get_project_url`, `search_docs`, and `execute_sql` with `SELECT`. Never `apply_migration`, never INSERT/UPDATE/DELETE/CREATE/ALTER/DROP/GRANT, no branches, edge functions, secrets or storage changes. If unsure whether something writes, don't run it — ask.
- **SQL files are written here; the human runs them** (same as the brain's SQL files).
- **Never touch `public.*` or any schema other than `crm`.** Reading `public.revenueos_profiles` / `public.revenueos_projects` is the only allowed cross-schema access.
- Do not touch the old repo (`../Lead-Managment-System`).

## Goal

A HubSpot-style CRM for MOTM's team, serving many clients. **One workspace = one client project.**
The RevenueOS brain does cold outreach; this CRM nurtures the qualified leads (email + WhatsApp via Baileys), through calls, meetings, proposals and won/lost.

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

### Kept features
CSV import, calls + routing, nurture workflows + worker, templates + attachments, email (Resend/SMTP), WhatsApp (Baileys), Google Calendar, meetings, proposals, tasks, DNC, merge, delete + audit, notifications, dashboard, workspaces, admin users.

## Tables (32, all in `crm`)

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

## Open items

- **`crm_app` role**: needs approval from the platform developers before any SQL is run.
- **Google privacy URL**: `/privacy` was removed; Google OAuth consent verification needs a public privacy-policy URL hosted elsewhere (e.g. the marketing site).
- **`brain_customer_key` check**: confirm `revenueos_projects.brain_customer_key` matches the brain's `customer` text (QuickICP tables) before building brain pushes.
- **Refresh `CONTEXT.md`** once the `crm` schema and code are in place (it still describes the old system).

## Commands

Backend (`cd Backend`): `npm run typecheck`, `npm run lint`, `npm run test:run`, `npm run build`.
Frontend (`cd Frontend`): `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:run`, `npm run build` (the build regenerates `src/routeTree.gen.ts`).
