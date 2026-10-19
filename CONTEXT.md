# Northbeam CRM (v2): Project Context

Last refreshed: 2026-10-16. What the system is and how it fits together. Rules and decisions
(and why) live in [CLAUDE.md](CLAUDE.md); this file links there instead of repeating them.

## What it is

A HubSpot-style CRM for MOTM's team, serving many clients. **One workspace = one client
project.** The RevenueOS brain does cold outreach (QuickICP, Quickhowl AI calls, Email Tool) and
pushes everything it finds into the client's workspace. The CRM holds all of a client's companies,
contacts, calls and campaign emails, and the team nurtures the qualified contacts by email and
WhatsApp through calls, meetings and proposals to won or lost.

```text
Browser SPA ──> Backend API (Express) ──> Supabase Postgres, schema crm  (+ Auth, Storage)
RevenueOS brain ──> /api/v1/brain/v1 ──┘
Worker ──> Email (Resend/SMTP), WhatsApp (Baileys), Google Calendar
```

The frontend uses Supabase JS only to sign in. Every CRM read and write goes through `Backend/`.

## Repository

- `Backend/`: Node 22, TypeScript ESM, Express, `pg`, Zod. `src/routes` (HTTP), `src/services`
  (transactions and business rules), `src/domain` (pure routing and rendering), `src/providers`
  (email, WhatsApp, calendar), `src/worker.ts`. Tests in `tests/` (unit + PGlite integration).
- `Frontend/`: React 19, Vite, TanStack Router + Query, Tailwind 4, Radix UI, Tiptap, Vitest.
- `Supabase/migrations/`: SQL files `000`–`013`, written here and run by hand by the human.
- `Backend/demo/`: demo mode only; never built or shipped.
- `compose.yaml`: `backend`, `worker` and `frontend` services.

## Database

- All CRM tables (35) and enums live in schema **`crm`** in the shared RevenueOSDatabase Supabase
  project, next to the platform and the brain. The table list is in
  [CLAUDE.md → Tables](CLAUDE.md#tables-35-all-in-crm).
- Backend and worker log in as role **`crm_app`** (rights on `crm`, plus read-only access to
  `public.revenueos_profiles` and `public.revenueos_projects`). RLS is on for every `crm` table
  with no policies; `crm` is not exposed through the Data API.
- **Migrations `000`–`013` have not been run yet.** Order:

| File | Contents |
|---|---|
| `000_platform_grants.sql` | `crm_app` role; run by a platform developer after approval |
| `001_crm_schema.sql` | schema `crm`, grants |
| `002_crm_enums.sql` | enum types |
| `003_crm_identity.sql` | profiles, workspaces, workspace members |
| `004_crm_core.sql` | companies, contacts, contact channels, DNC events, deals |
| `005_crm_activity.sql` | notes, calls, tasks, meetings, proposals, timeline, notifications |
| `006_crm_automation.sql` | templates, attachments, workflows, versions, steps, runs, scheduled actions |
| `007_crm_integrations.sql` | email, Google Calendar, WhatsApp tables |
| `008_crm_audit.sql` | deleted-records and admin audit |
| `009_crm_triggers.sql` | updated_at, DNC history, consent/automation stop, outcome cascade |
| `010_crm_rls.sql` | RLS on, no policies |
| `011_crm_brain_intake.sql` | lifecycle stage, external refs, AI calls, email activities, brain API keys, default owner |
| `012_crm_deal_closed_at.sql` | `deals.closed_at` |
| `013_crm_deal_amount.sql` | `deals.amount` + `currency` (INR) |

- Storage buckets `crm-template-attachments` and `crm-proposal-documents` are created by hand in
  the Supabase dashboard.

## Data model

- **Company → contacts → deals**, all per workspace. A company has many contacts and deals.
- **The contact owns consent**: status active / do-not-contact / merged, per-channel status
  (phone, email, WhatsApp), DNC history, merge. Every send checks the contact first.
- **The contact has a lifecycle stage**: prospect → contacted → engaged → qualified → customer.
  Code moves it forward only; admins can move it back.
- **The deal owns the sales journey**: pipeline stage (`new` … `negotiation`, see
  `Backend/src/domain/enums.ts`), outcome (open / won / lost / nurture / discarded), automation
  mode, objection, interested-later fields, loss reason, owner, `closed_at`, `amount` (INR, optional). A contact has at most
  one open deal per workspace.
- Activity hangs off contacts and deals: notes, calls (human and AI), tasks, meetings,
  proposals, email activities, timeline events, notifications.
- The detailed rules (no-open-deal call routing, merge with DNC, nurture reopen) are in
  [CLAUDE.md → Data model rules](CLAUDE.md#data-model-rules) and
  [Backend rework rules](CLAUDE.md#backend-rework-rules-2026-10-16).

## Users and access

- Shared Supabase Auth with the platform and brain. CRM access = an active `crm.profiles` row
  (role `admin` or `salesperson`); otherwise 403. Names and emails come from
  `public.revenueos_profiles`.
- **Admins** see every workspace, use the whole app plus `/admin`, manage users, workspaces,
  members and brain keys, and get no notifications.
- **Salespeople** see only workspaces they are members of.
- The CRM never creates auth users: accounts are made on the platform, then given CRM access.
- Every CRM request carries `Authorization: Bearer <token>` and `X-Workspace-Id`; `/me`,
  `/profiles`, `/workspaces` and `/admin` do not need the workspace header.

## API (`/api/v1`)

| Area | Routes |
|---|---|
| Session | `/me`, `/profiles` |
| Admin | `/admin/users`; `/workspaces` (create/edit, `/:id/members`, `/:id/brain-keys`) |
| Core | `/companies`, `/contacts` (calls, notes, merge, DNC, CSV import), `/deals` (+ `/:id/tasks|meetings|proposals|runs|timeline`) |
| Activity | `/tasks`, `/meetings`, `/proposals` (+ `/summary`, document upload, send) |
| Automation | `/workflows`, `/templates` (+ `/variables`, `/preview`, attachments), `/runs`, `/scheduled-actions` |
| Other | `/dashboard/summary`, `/notifications`, `/connections/*` (email, WhatsApp, Google Calendar) |
| Brain | `/brain/v1/*` (see below) |

Workspace lists are paginated (`limit`/`offset`, `total` from the server). The deal page uses
deal-filtered calls instead of the paged lists.

## Brain intake

The brain writes only through `/api/v1/brain/v1` with a per-workspace service key (SHA-256 hash
stored, full key shown once).

- `POST /companies`, `/contacts`, `/calls`, `/email-events`, `/handovers`: batches of up to 500
  items, one transaction per item, per-item results, idempotent by external ids.
- `GET /suppressions`: who must not be contacted (DNC, unsubscribed, bounced).
- Matching: external ref → email → E.164 phone. Brain data only fills empty fields.
- A handover opens a deal (lifecycle → qualified) and notifies its owner. Its optional `amount`
  (INR) fills the deal's amount only when that is empty.

Details: [CLAUDE.md → Brain intake](CLAUDE.md#brain-intake-2026-10-16).

## Automation and worker

- Workflows (trigger → versioned steps) enroll **deals**, never prospects. Triggers include
  `deal_created`, call outcomes, objections, meeting outcomes, `proposal_pending`, and manual
  enrollment (full list: `WORKFLOW_TRIGGERS` in `Backend/src/domain/enums.ts`). Published
  versions are never edited; a run stays on its version.
- Steps: send email, send WhatsApp, create call/follow-up task, change stage, stop workflow.
  Each step becomes a `scheduled_action`.
- Templates use `{{contact.*}}`, `{{company.*}}`, `{{deal.*}}`, `{{meeting.*}}` and date
  variables. The list lives in `Backend/src/domain/templateRenderer.ts`; publishing is refused if
  a template uses an unknown variable.
- A draft may hold a send step without a template; publishing refuses it ("Step N (send_email)
  requires a template."). A template used by a live version or a run in progress (running /
  waiting / paused) can't be deleted or switched off (409 naming the workflows); one kept only by
  an earlier published version can be switched off but not deleted (published steps never change).
- If a send still finds its template missing or inactive, the worker skips it, the run carries on,
  and the deal owner (or, with no owner, every salesperson member) gets a warning notification.
- `Backend/src/worker.ts` is the only executor. Each tick claims due scheduled actions, rechecks
  eligibility (outcome, DNC, channel status, automation mode, reply state), runs the step, records
  the result and schedules the next step. It also sends queued proposal and meeting WhatsApp
  messages and keeps one WhatsApp socket per active workspace.
- `WORKER_DRY_RUN=true` logs instead of sending.

## Integrations (per workspace, on the Settings page)

- **Email**: Resend or SMTP; secrets encrypted in Postgres (`INTEGRATION_ENCRYPTION_KEY`).
  `RESEND_API_KEY` / `SMTP_FROM_*` env vars are a fallback until a workspace saves its own.
- **WhatsApp**: Baileys (unofficial WhatsApp Web), one paired number per workspace, daily cap
  and send spacing, encrypted credentials. Inbound replies store metadata only (never the body)
  and stop the matching automation. Account-ban risk remains.
- **Google Calendar**: OAuth (platform env app or per-workspace credentials). Meetings create
  events with a Meet link; sync is best-effort and never rolls back a saved meeting.

## Frontend pages

| Route | Page |
|---|---|
| `/` | Dashboard: lifecycle funnel, open deals by stage, won/lost this month, week's activity, tasks due/overdue, today's queue |
| `/contacts`, `/contacts/$id` | Contacts (search, filters, CSV import), contact detail (consent, calls, notes, deals) |
| `/companies`, `/companies/$id` | Companies and company detail |
| `/deals`, `/deals/$id` | Pipeline board (drag and drop + stage dropdown), deal detail (journey card, tasks, meetings, proposals, runs, timeline) |
| `/tasks` | Today / Overdue / Upcoming / Completed (Asia/Kolkata days) |
| `/meetings` | Upcoming / Past, Today card, outcomes |
| `/proposals` | Workspace stats, create → upload document → send |
| `/automations`, `/automations/templates`, `/automations/runs` | Workflows and builder, templates (variable picker, preview), runs and scheduled actions |
| `/settings` | Workspace defaults (owner, meeting templates) and connections |
| `/admin` | Admins only: users, workspaces, members, brain API keys |

The sidebar has a workspace switcher and a notification bell.

## Demo mode

`cd Backend && npm run demo` → http://127.0.0.1:8080 (`admin@`, `sam@`, `priya@demo.local`,
password `demo`). One process runs PGlite with migrations 000–013 and seed data, a fake Supabase
Auth/Storage, the API on :8787, a dry-run worker and Vite. Data is in memory. Guards and limits:
[Backend/README.md → Demo mode](Backend/README.md#demo-mode-local-click-through).

## Configuration

- Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL`.
- Backend: `PORT` (8787), `CORS_ORIGINS`, `DATABASE_URL` (as `crm_app`), `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `INTEGRATION_ENCRYPTION_KEY` (base64 32-byte key, the same on API
  and worker, never rotated casually), `NODE_ENV`; optional `GOOGLE_OAUTH_CLIENT_ID` /
  `_SECRET` / `_REDIRECT_URI` (all three or none).
- Worker: `WORKER_POLL_INTERVAL_MS`, `WORKER_BATCH_SIZE`, `WORKER_DRY_RUN`; optional
  `RESEND_API_KEY`, `SMTP_FROM_NAME`, `SMTP_FROM_ADDRESS`.

Commands: [CLAUDE.md → Commands](CLAUDE.md#commands).

## Rollout checklist

1. Platform developers approve the `crm_app` role; they run `000_platform_grants.sql` and set
   its password outside version control.
2. The human runs `001`–`013` in order.
3. Create the storage buckets `crm-template-attachments` and `crm-proposal-documents` by hand.
4. Set the backend, worker and frontend env vars (one stable `INTEGRATION_ENCRYPTION_KEY`).
5. Give the first admin CRM access (their account already exists on the platform):
   `insert into crm.profiles (id, role) select id, 'admin' from public.revenueos_profiles where lower(email) = '<email>';`
6. The admin creates the client workspaces (with platform project ids), adds salespeople
   (Users tab) and assigns them (Members tab), sets each default owner.
7. Deploy with email and WhatsApp outbound off. Per workspace: configure and test email, connect
   Google Calendar, pair WhatsApp and confirm a worker restart reconnects without a new QR.
8. Send one opted-in internal email and WhatsApp message, reply, and confirm automation stops.
9. Create a brain key per workspace, hand it to the brain, check `GET /brain/v1/suppressions`,
   then push a small batch.
10. Turn WhatsApp outbound on only once cap, connection and pending counts look healthy.

Rollback starts with WhatsApp outbound off and pausing workflows and runs.

## Open items

See [CLAUDE.md → Open items](CLAUDE.md#open-items): `crm_app` approval, a public privacy-policy
URL for Google OAuth verification, the `brain_customer_key` check, the retention period for
reply text and transcripts, and the Email Tool results endpoint (email events beyond `sent`).
