# Northbeam CRM — Backend

The trusted business layer between the existing frontend and the Supabase
foundation (`Supabase/migrations/001_initial_migration.sql`):

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
  supabaseAdmin.ts        Supabase client used ONLY to verify bearer tokens
  authMiddleware.ts        requireAuth: verifies token, loads active profile
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
# fill in DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
npm run dev
```

`DATABASE_URL` must point at the same Supabase Postgres database the
`Supabase/migrations/001_initial_migration.sql` migration has been applied
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
POST       /leads/:id/won | /lost | /discard | /reactivate
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
```

### Automation executor API (`/api/v1/automation`) — n8n only

Everything above requires a salesperson's Supabase session
(`Authorization: Bearer <supabase-access-token>`). `/api/v1/automation/*` is
a separate trust boundary for the n8n executor described in `n8n/README.md`:
it requires an `X-Automation-Key` header matching `N8N_SERVICE_API_KEY`
(see `.env.example`, `src/serviceAuthMiddleware.ts`) instead — n8n never
gets a Supabase session, and this key unlocks nothing outside this router.
Salesperson auth (`requireAuth`) is completely unchanged.

```
POST /automation/due-actions/claim          {limit?}  — concurrency-safe claim (SKIP LOCKED)
GET  /automation/actions/:id/context                  — fresh lead/run/step/template + eligibility
POST /automation/actions/:id/skip           {reason}
POST /automation/actions/:id/execute-internal          — create_call_task / create_follow_up_task /
                                                          change_lead_stage / stop_workflow: backend
                                                          performs the mutation AND advances the run
POST /automation/actions/:id/result         {outcome, providerMessageId?, error?, retryable?}
                                                        — send_email / send_whatsapp results only;
                                                          success advances the run, failure applies
                                                          backend-owned retry/backoff
POST /automation/inbound-events             {leadId, channel, providerMessageId?, occurredAt?, summary}
GET  /automation/leads/lookup               ?email=&phone=  — narrow read-only lookup for n8n/07,
                                                                which has no salesperson session to
                                                                call the normal /leads search with
```

All business logic — next-step selection, delay calculation, template/stage
resolution, retry/backoff, eligibility (lifecycle/DNC/automation-mode/
contactability/response-state) — lives in `src/services/automation.service.ts`.
n8n only calls these routes and acts on the response; it never encodes a
business workflow's steps, delays, or templates itself. See
`n8n/README.md` for the full architecture and how each of the 10 n8n
workflows uses this API.

**The reverse direction** — this backend calling _out_ to n8n — is a single,
optional, fire-and-forget nudge: `src/services/n8nWake.ts`'s
`wakeAutomationExecutor()`, called from `runs.service.ts` whenever a
scheduled action becomes due immediately, `POST`s to n8n's `Wake Webhook`
(`N8N_WAKE_WEBHOOK_URL` / `N8N_WAKE_WEBHOOK_SECRET` in `.env.example`) so a
salesperson doesn't wait up to a minute for n8n's own poll to notice. It is
never awaited and every failure is swallowed — leaving it unconfigured only
costs latency, never correctness (see `n8n/README.md` §6.2).

## What this backend deliberately does NOT do

- Talk to any email/WhatsApp provider directly, or run a scheduler loop —
  that's n8n's job (`n8n/01-due-action-worker.json` polls
  `/automation/due-actions/claim`). This backend only decides _what_ should
  happen and _when_, and records what n8n reports back.
- Manager/Admin roles or RBAC — one user type, Salesperson, per the product
  brief.
