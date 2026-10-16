# Northbeam CRM — Backend

The trusted business layer between the existing frontend and the Supabase
foundation (`Supabase/migrations/*.sql`, applied in order):

```
Frontend  →  Backend (this)  →  Supabase Postgres + Auth
```

Node 22 + TypeScript (ESM) + Express + `pg` (direct Postgres access, not
PostgREST) + `zod` for validation. Auth identity comes from Supabase Auth;
business data access goes through a direct Postgres connection so
multi-table writes (e.g. "log a call" touching `calls`, `leads`, `tasks`,
`timeline_events`, `workflow_runs`) can be wrapped in a real transaction —
something PostgREST-style REST calls can't give you.

## Layout

```
src/
  env.ts                 zod-validated environment config
  db.ts                  pg Pool + withTransaction() helper
  supabaseAdmin.ts        server-only Supabase Auth verification/admin client
  authMiddleware.ts        verifies token, active profile, and role
  errors.ts / errorMiddleware.ts   typed AppError taxonomy -> JSON responses
  domain/                 pure business-rule modules (no I/O, unit-tested)
    enums.ts               mirrors the migration's Postgres enums
    pipeline.ts             lifecycle/pipeline-stage guards
    callRouting.ts           call outcome -> stage/automation/task/workflow
    meetingRouting.ts        meeting outcome -> stage/lifecycle/task
    proposalRouting.ts       proposal status -> stage/lifecycle/task
  services/                one file per aggregate: SQL + orchestration,
                            composable inside a single db transaction
  routes/                  thin Express routers: validate -> call service -> respond
tests/
  unit/                    domain logic, no DB required
  integration/              real business flows against a live Postgres,
                            skipped unless TEST_DATABASE_URL is set
```

## Why direct Postgres instead of the Supabase JS client for data access

RLS stays enabled on every table (defense-in-depth), but this backend
connects with a role that bypasses it (see `.env.example`) and enforces
authorization itself — the same trust model Supabase's own `service_role`
key has over PostgREST. The difference is `pg` gives us real
`BEGIN`/`COMMIT`/`ROLLBACK` transactions, which composite business
operations (log a call, complete a meeting, publish a workflow version)
require (see Rule 16 in the product brief: a business operation must fully
land or not at all). `@supabase/supabase-js` is used for exactly one thing:
`supabase.auth.getUser(token)` to verify who is calling.

## Setup

```bash
cd Backend
npm install
cp .env.example .env
# fill in DATABASE_URL, Supabase values, and INTEGRATION_ENCRYPTION_KEY
npm run dev
```

`DATABASE_URL` must point at the same Supabase Postgres database the
all `Supabase/migrations/*.sql` migrations have been applied in order
to, using a role that bypasses RLS (the Supabase dashboard's `postgres`
connection string, or a dedicated backend role you grant `BYPASSRLS`).

## Scripts

```bash
npm run dev             # tsx watch — auto-restarting dev server
npm run build            # tsc -> dist/
npm start                 # node dist/index.js (after build)
npm run typecheck
npm run lint
npm test / test:run        # vitest (watch / single run) — unit + integration
npm run test:unit           # domain logic only, no DB needed
npm run test:integration     # requires TEST_DATABASE_URL, see below
npm run check              # typecheck && lint && test:run
```

## Demo mode (local click-through)

```sh
cd Backend
npm run demo
```

Open http://127.0.0.1:8080 and click a demo user (password `demo` for all):
`admin@demo.local` (admin), `sam@demo.local` (salesperson, both workspaces),
`priya@demo.local` (salesperson, Acme only). Ctrl+C stops everything.

One Node process runs it all: PGlite with migrations 000-012 and seed data (two client
workspaces, companies, contacts in every lifecycle stage, deals in every outcome, tasks,
AI + human calls, campaign emails, a meeting, a proposal, notifications), a local fake of
Supabase Auth/Storage, the API on 127.0.0.1:8787, the automation worker in dry run, and the
frontend dev server on 127.0.0.1:8080. Data is in memory and reset on every start.

Guards (code in `demo/`, tests in `demo/*.test.ts` and
`Frontend/src/features/auth/demo-login.build.test.ts`):
- runs only with `DEMO_MODE=true` and `NODE_ENV=development` (set by `demo/demo.env`; a shell
  `NODE_ENV=production` wins and it refuses), and refuses if `DATABASE_URL` is set;
- after loading, the database must be the local PGlite and auth the local fake, and provider
  keys (`RESEND_API_KEY`, `SMTP_FROM_ADDRESS`, `GOOGLE_OAUTH_*`) are blanked and checked;
- `demo/` is outside the build (`tsconfig.json` includes only `src` and `tests`), so it is never
  in `dist/` or a Docker image; compose and the Dockerfiles never mention it;
- the frontend demo login is dev-only and is removed from production builds.

Not available in demo mode: creating real user accounts, Google Calendar connect, WhatsApp
pairing, and real email sends (the worker logs "(dry run)" instead).

## Running the integration tests

`tests/integration/*.test.ts` exercise full business flows (create lead →
log call → outcome routing → workflow enrollment, DNC cascade, etc.)
against a real Postgres instance running the migration. They're skipped
automatically when `TEST_DATABASE_URL` isn't set, so `npm test` is green in
any environment — including this one, which has no Docker/Supabase CLI
available and so was never able to run them. To actually run them:

```bash
# against a local Supabase stack (requires Docker + the Supabase CLI):
supabase start
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:54322/postgres npm run test:integration

# or against a disposable Supabase project with the migration applied:
TEST_DATABASE_URL=postgres://postgres:<password>@db.<ref>.supabase.co:5432/postgres npm run test:integration
```

## API shape

All business routes are mounted under `/api/v1` and require
`Authorization: Bearer <supabase-access-token>`. `GET /health` is
unauthenticated (liveness only). Errors are always
`{ "error": { "code": string, "message": string, "details"?: unknown } }`
with a matching HTTP status — see `src/errors.ts` for the taxonomy
(`invalid_input` 400, `authentication_failed` 401, `forbidden` 403,
`not_found` 404, `conflict` 409, `do_not_contact` 409,
`invalid_transition` 422, `internal_error` 500).

Key endpoints (see `src/routes/*.ts` for the complete list):

```
GET/POST   /leads                          list / create
GET/PATCH  /leads/:id                       detail / edit descriptive fields
POST       /leads/:id/notes
POST       /leads/:id/communications        persist manual email/WhatsApp activity
POST       /leads/:id/automation            {mode, reason?}
POST       /leads/:id/dnc                   {reason}
POST       /leads/:id/dnc/reactivate        {reason}
POST       /leads/:id/won | /discard | /reactivate
POST       /leads/:id/lost                   {lossReason, notes?}
POST       /leads/:id/long-term-nurture      {reason?}
POST       /leads/:id/merge                 {targetLeadId, reason?}
GET/POST   /leads/:id/contactability
GET/POST   /leads/:id/calls                  logging a call IS outcome processing
GET        /leads/:id/timeline | /meetings | /proposals | /runs

GET/POST   /tasks                            PATCH /tasks/:id, POST /tasks/:id/complete | /cancel
GET/POST   /meetings                          PATCH /meetings/:id, POST /meetings/:id/outcome
GET/POST   /proposals                          PATCH /proposals/:id, POST /proposals/:id/status

GET/POST   /workflows                          PATCH /workflows/:id
POST       /workflows/:id/draft
PUT        /workflows/:id/versions/:v/steps
POST       /workflows/:id/versions/:v/publish
POST       /workflows/:id/duplicate
GET/POST   /templates                           PATCH /templates/:id

GET/POST   /runs                                 POST /runs/:id/pause|resume|cancel|retry
GET        /scheduled-actions                     (read/cancel only, salesperson-facing)

GET        /dashboard/summary
GET/POST   /notifications                          POST /notifications/:id/read
GET        /me | /profiles

GET/POST/PATCH /admin/users
GET/PUT        /admin/connections/email
POST           /admin/connections/email/test
GET/PUT        /admin/connections/whatsapp/settings
POST           /admin/connections/whatsapp/connect|restart|logout
```

### Automation execution

There is no external executor and no separate service-auth API surface —
`src/worker.ts` is a standalone Node process (`npm run worker`) that polls
`scheduled_actions` directly and calls the same functions in
`src/services/automation.service.ts` in-process: claim due actions
(concurrency-safe `SKIP LOCKED` claim), recheck eligibility
(lifecycle/DNC/automation-mode/contactability/response-state), render the
template, send through the admin-selected Resend/TLS SMTP connection or the
single shared Baileys socket, and record the
result — which advances the run to the next step or applies backend-owned
retry/backoff on failure. All business logic (next-step selection, delay
calculation, template/stage resolution, retry/backoff, eligibility) lives
in `automation.service.ts`; `worker.ts` is deliberately thin and just calls
it on a poll loop (see `INTEGRATION_ENCRYPTION_KEY` / `WORKER_*` in
`.env.example`).

The worker owns the only Baileys socket and holds a PostgreSQL advisory lock
for its lifetime. Baileys credentials and individual Signal keys are stored
encrypted in Postgres; QR values are admin-only and short-lived. Inbound
direct replies retain metadata only and atomically stop all matching lead
automation. Baileys is an unofficial WhatsApp Web client, so protocol and
account-enforcement risk remains even with conservative throttling.

## Initial administrator

Create the first identity in Supabase Auth, then promote it after migration:

```sql
update public.profiles set role = 'admin' where email = 'admin@example.com';
```

Admin identities are restricted to `/admin`; salesperson identities are
restricted to CRM business routes.

## Safe production rollout

1. Apply migrations in filename order and set one stable
   `INTEGRATION_ENCRYPTION_KEY` on both API and worker.
2. Promote the first admin with the SQL above, then deploy with Email and
   WhatsApp outbound disabled.
3. Configure and test Resend or encrypted SMTP in Admin → Connections.
4. Pair a disposable, dedicated WhatsApp account and verify worker restart
   reconnects without a second QR.
5. Send one opted-in internal message, reply, and confirm the matching run
   and future actions are cancelled without reply content being stored.
6. Enable WhatsApp outbound only after the cap, heartbeat, restriction state,
   and pending counts look healthy.

Rollback starts by switching WhatsApp outbound off. The migration is
additive and scheduled actions remain in Postgres; restoring a prior provider
image is an explicit manual deployment decision, not an automatic fallback.
