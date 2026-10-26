# Northbeam CRM — Backend

The trusted business layer of the v2 CRM. The system overview is in
[`../CONTEXT.md`](../CONTEXT.md); rules and decisions are in [`../CLAUDE.md`](../CLAUDE.md).

```
Frontend / RevenueOS brain  →  Backend (this)  →  Supabase Postgres (public.crm_* tables) + Auth + Storage
Worker (src/worker.ts)      →  Email (Resend/SMTP), WhatsApp (Baileys), Google Calendar
```

Node 22 + TypeScript (ESM) + Express + `pg` + `zod`. Auth identity comes from Supabase Auth
(`supabase.auth.getUser(token)`); all CRM data goes through a direct Postgres connection, so
multi-table writes (e.g. "log a call" touching `crm_calls`, `crm_deals`, `crm_tasks`,
`crm_timeline_events`, `crm_workflow_runs`) run in one real transaction.

## Layout

```
src/
  env.ts / workerEnv.ts   zod-validated environment config (API / worker)
  db.ts                   pg Pool + withTransaction()
  supabaseAdmin.ts        server-only Supabase Auth/Storage client
  authMiddleware.ts       token -> active crm_profiles row -> role; workspace access
  errors.ts / errorMiddleware.ts   typed AppError taxonomy -> JSON responses
  domain/                 pure rules, no I/O (enums, pipeline, call/meeting/proposal routing,
                          template renderer, phone/email normalisation)
  services/               one file per aggregate: SQL + orchestration inside a transaction
  routes/                 thin Express routers: validate -> call service -> respond
  providers/              email, WhatsApp (Baileys), Google Calendar
  security/               AES encryption for stored secrets
  worker.ts               automation worker (separate process)
tests/
  unit/                   domain logic
  integration/            full HTTP flows on PGlite (see below)
demo/                     demo mode only; never built or shipped
```

## Database and access

- Every CRM table, enum and function lives in schema `public` with the prefix **`crm_`** in the
  shared RevenueOSDatabase Supabase project. The backend never writes outside `crm_*`; it only reads `public.revenueos_profiles`
  (names, emails) and `public.revenueos_projects` (workspace links).
- Backend and worker connect as role **`crm_app`** (created by `000_platform_grants.sql`, DML
  on each `crm_*` table from `crm_secure_objects()` in `001`). It has `BYPASSRLS`: RLS is on for every `crm_*` table with no
  policies, `anon`, `authenticated` and `service_role` have no rights on them, and this backend enforces access in code.
- CRM access = an active **`crm_profiles`** row (`admin` or `salesperson`); a valid account
  without one gets 403. Salespeople see only workspaces in `crm_workspace_members`; admins see
  all. The CRM never creates or changes auth accounts.

### Migrations (`../Supabase/migrations`, run by hand, in this order)

1. `000_platform_grants.sql`: the `crm_app` role. Run once by a platform developer, as
   `postgres`, after the platform team approves; then set its password outside version control
   (`alter role crm_app with password '…'`).
2. `001_crm_schema.sql` … `013_crm_deal_amount.sql`, in filename order: schema and grants,
   enums, identity, core, activity, automation, integrations, audit, triggers, RLS, brain intake,
   `deals.closed_at`, deal amount.

They have not been run on the shared project yet.

### Storage buckets

Create these two private buckets by hand in the Supabase dashboard (not by SQL):
`crm-template-attachments` and `crm-proposal-documents`.

## Setup

```bash
cd Backend
npm install
cp .env.example .env
# fill in DATABASE_URL (as crm_app), Supabase values and INTEGRATION_ENCRYPTION_KEY
npm run dev
```

Through the Supabase pooler the database user is `crm_app.<project_ref>`. Use one stable
`INTEGRATION_ENCRYPTION_KEY` for both API and worker.

## Scripts

```bash
npm run dev               # tsx watch — API dev server
npm run worker:dev        # tsx watch — worker
npm run build             # tsc -> dist/
npm start                 # node dist/src/index.js (after build)
npm run worker            # node dist/src/worker.js (after build)
npm run typecheck         # src + tests, and demo/
npm run lint
npm test / test:run       # vitest (watch / single run): unit, integration and demo tests
npm run test:unit
npm run test:integration
npm run check             # typecheck && lint && test:run
npm run demo              # local click-through, see below
```

## Demo mode (local click-through)

```sh
cd Backend
npm run demo
```

Open http://127.0.0.1:8080 and click a demo user (password `demo` for all):
`admin@demo.local` (admin), `sam@demo.local` (salesperson, both workspaces),
`priya@demo.local` (salesperson, Acme only). Ctrl+C stops everything.

One Node process runs it all: PGlite with migrations 000-013 and seed data (two client
workspaces, companies, contacts in every lifecycle stage, deals in every outcome, tasks,
AI + human calls, campaign emails, a meeting today, a proposal, notifications, brain keys and an
inactive user), a local fake of Supabase Auth/Storage, the API on 127.0.0.1:8787, the automation
worker in dry run, and the frontend dev server on 127.0.0.1:8080. Data is in memory and reset on
every start.

Guards (code in `demo/`, tests in `demo/*.test.ts` and
`Frontend/src/features/auth/demo-login.build.test.ts`):
- runs only with `DEMO_MODE=true` and `NODE_ENV=development` (set by `demo/demo.env`; a shell
  `NODE_ENV=production` wins and it refuses), and refuses if `DATABASE_URL` is set;
- after loading, the database must be the local PGlite and auth the local fake, and provider
  keys (`RESEND_API_KEY`, `SMTP_FROM_ADDRESS`, `GOOGLE_OAUTH_*`) are blanked and checked;
- `demo/` is outside the build (`tsconfig.json` includes only `src` and `tests`), so it is never
  in `dist/` or a Docker image; compose and the Dockerfiles never mention it;
- the frontend demo login is dev-only and is removed from production builds.

Not available in demo mode: Google Calendar connect, WhatsApp pairing, and real email sends (the
worker logs "(dry run)" instead).

## Integration tests

`tests/integration/*.test.ts` run full HTTP flows (contacts → deals → calls and routing,
meetings, proposals, workflows and the worker, brain intake, admin) on an in-process
**PGlite** database with migrations `000`–`013` applied on stand-in `auth` and `public` tables
(`tests/integration/testDb.ts`). No Docker or Supabase needed; `npm run test:run` includes them.
All connections share one PGlite session, so the tests run sequentially.

## API shape

Everything is under `/api/v1` and needs `Authorization: Bearer <supabase-access-token>`;
workspace-scoped routes also need `X-Workspace-Id`. `GET /health` is unauthenticated. Errors are
always `{ "error": { "code", "message", "details"? } }` with a matching status (see
`src/errors.ts`: `invalid_input` 400, `authentication_failed` 401, `forbidden` 403, `not_found`
404, `conflict` 409, `do_not_contact` 409, `invalid_transition` 422, `internal_error` 500).
Workspace lists are paged (`limit`, `offset`; the response has `total`).

```
GET        /me | /profiles
GET/POST/PATCH  /admin/users                     admins: email + role only; role / active
GET/POST/PATCH  /workspaces                      list (all users); create / edit (admins)
GET/PUT    /workspaces/:id/members               admins
GET/POST/DELETE /workspaces/:id/brain-keys       admins; the full key is returned once

GET/POST   /companies          GET/PATCH /companies/:id
GET/POST   /contacts           GET/PATCH /contacts/:id, POST /contacts/import
           /contacts/:id/notes | /calls | /dnc | /dnc/reactivate | /merge
GET/POST   /deals              GET/PATCH /deals/:id, outcome actions (won, lost, nurture, …)
GET        /deals/:id/tasks | /meetings | /proposals | /runs | /timeline

GET/POST   /tasks              PATCH /tasks/:id, POST /tasks/:id/complete | /cancel
GET/POST   /meetings           PATCH /meetings/:id, POST /meetings/:id/outcome   (when=upcoming|past|today)
GET/POST   /proposals          GET /proposals/summary, POST /proposals/:id/document | /send | /status

GET/POST   /workflows          drafts, steps, publish, duplicate
GET/POST   /templates          GET /templates/variables, POST /templates/preview, attachments
GET/POST   /runs               POST /runs/:id/pause | resume | cancel | retry
GET        /scheduled-actions

GET        /dashboard/summary
GET        /notifications      POST /notifications/:id/read | /read-all
GET/PUT    /connections/email | /whatsapp/settings | /google-calendar …

POST       /brain/v1/companies | /contacts | /calls | /email-events | /handovers
GET        /brain/v1/suppressions                brain service key, not a user token
```

See `src/routes/*.ts` for the complete list.

### Automation execution

`src/worker.ts` is a separate Node process (`npm run worker`) that calls the same service code
in-process. Each tick it claims due `crm_scheduled_actions` (`SKIP LOCKED`), rechecks
eligibility (deal outcome, DNC, channel status, automation mode, reply state), renders the
template, sends through the workspace's email connection or WhatsApp socket, records the result
and schedules the next step (or retries with backoff). It also sends queued proposal and meeting
WhatsApp messages. `WORKER_DRY_RUN=true` logs instead of sending.

The worker keeps one Baileys socket per active workspace, each behind its own PostgreSQL
advisory lock. Baileys credentials and Signal keys are stored encrypted; QR codes are short-lived
and shown only on the Settings page. Inbound replies keep metadata only (never the body) and stop
the matching automation. Baileys is unofficial, so protocol and account-ban risk remains.

## First admin

The person's account must already exist on the RevenueOS platform. Give it CRM access (the
human runs this; the CRM never writes to `public.*`):

```sql
insert into crm_profiles (id, role)
select id, 'admin' from public.revenueos_profiles where lower(email) = lower('admin@example.com');
```

After that, the admin manages everyone else in the app: **Admin → Users** (add an existing
RevenueOS account by email, set role, activate/deactivate), **Workspaces**, **Members** and
**Brain API keys**.

## Safe production rollout

1. `crm_app` approved and created (`000`), then `001`–`013` run in order, and the two storage
   buckets created.
2. Set the env vars, with one stable `INTEGRATION_ENCRYPTION_KEY` on API and worker; deploy
   with email and WhatsApp outbound off.
3. Add the first admin (SQL above); the admin creates the client workspaces, adds and assigns
   salespeople, and sets each workspace's default owner.
4. Per workspace, on the **Settings** page: configure and test email (Resend or SMTP), connect
   Google Calendar, pair a dedicated WhatsApp number and check a worker restart reconnects
   without a new QR.
5. Send one opted-in internal email and WhatsApp message, reply, and confirm the matching run
   and future actions are cancelled without the reply text being stored.
6. Create a brain key per workspace (Admin → Brain API keys) and hand it to the brain; check
   `GET /brain/v1/suppressions`, then push a small batch.
7. Turn WhatsApp outbound on only once cap, connection state and pending counts look healthy.

Rollback starts by switching WhatsApp outbound off and pausing workflows/runs. Migrations are
additive; scheduled actions and provider state stay in Postgres.
