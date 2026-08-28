# Northbeam CRM — n8n automation layer

> **Status: optional / legacy path.** The Backend now has its own in-process
> automation executor (`Backend/src/worker.ts` — see
> `Backend/.env.example`'s "Outbound send" section), which polls
> `scheduled_actions` and sends via SMTP/the Meta WhatsApp Cloud API
> directly, with no external system required. That worker is what's
> actually running automation today. Everything below describes an
> alternative, fully-external executor (the same `/api/v1/automation/*`
> HTTP contract `automation.service.ts` exposes) for anyone who specifically
> wants n8n instead of — or alongside — the in-process worker. It is **not**
> required for automated messages to send.

**Business workflows are configured in Northbeam CRM, not in n8n.** Nothing
in this directory encodes "Not Connected Nurture," "Maybe Nurture,"
"Negative Nurture," "Proposal Pending Nurture," or any other nurture
sequence. n8n is a **generic execution engine**: 10 reusable technical
workflows that claim, dispatch, execute, and report on whatever the CRM's
database says should happen next. A salesperson editing a workflow's steps,
delays, templates, or order in the CRM UI changes lead behavior immediately
— **without touching, redeploying, or re-importing anything in this
directory.**

If you take away one thing from this document: **n8n contains zero business
sequences.** It contains one worker, one dispatcher, four action
executors, one progression handler, two inbound-communication paths, and
one error handler. That's it, forever — until a genuinely new *technical*
capability (e.g. SMS, a new provider) is added.

---

## 1. Architecture

```
Northbeam CRM UI  (salesperson builds/edits/publishes a workflow)
        │
        ▼
Backend  (validates, enforces business rules, owns state machine)
        │
        ▼
Supabase Postgres
  workflows → workflow_versions → workflow_steps → workflow_runs → scheduled_actions
        │
        ▼
n8n  (this directory) — generic executor
  01 Due Action Worker  →  02 Generic Action Dispatcher  →  03/04/05 executors
        │                                                        │
        ▼                                                        ▼
  Email / WhatsApp provider, or an internal CRM mutation    06 Result / Progression Handler
                                                                   │
                                                                   ▼
                                                    Backend advances the run, schedules the
                                                    NEXT scheduled_action from the SAME
                                                    workflow_version the run is on
```

The arrow from Supabase into n8n is a **poll**, not a push: Workflow 01's
Schedule Trigger claims due work every minute — the backend never needs to
know n8n's internals to make automation happen. There is exactly one
narrow exception, purely for latency, not correctness: the backend can
optionally call a small "wake now" webhook on Workflow 01 right after it
creates a scheduled action that's due immediately, instead of making a
salesperson wait up to ~60s for the next poll. See §6.

Responsibilities, restated as a rule each layer must never violate:

| Layer | Owns | Never does |
|---|---|---|
| CRM UI | Defines workflow steps, delays, templates, trigger, order | Talk to n8n or Supabase directly |
| Backend | Validates input, enforces business rules, is the *only* writer of workflow/run/scheduled-action state | Send an email/WhatsApp itself, or let n8n bypass its rules |
| Supabase | Stores the workflow configuration and the business truth (leads, runs, scheduled actions) | Contain any n8n-specific state |
| n8n | Executes technical actions (HTTP calls, provider sends) exactly as the backend instructs, on a schedule | Decide what a step means, what runs next, what the delay is, or what a template says |

This mirrors the schema already in `Supabase/migrations/001_initial_migration.sql`
(`workflows`, `workflow_versions`, `workflow_steps`, `workflow_runs`,
`scheduled_actions`, `message_templates`) and the backend service layer in
`Backend/src/services/`. Nothing here duplicates or second-guesses that
schema — n8n only calls the new `/api/v1/automation/*` routes added in
`Backend/src/routes/automation.routes.ts` and acts on the JSON they return.

### Why this is safe from drift

- **Next step**: `Backend/src/services/automation.service.ts`'s `advanceRun`
  reads the run's exact `workflow_version_id`, finds the next *enabled*
  `workflow_step` after the one just completed, and schedules it. n8n never
  hardcodes "email → wait 3 days → task."
- **Delay**: `workflow_steps.delay_days` is turned into a `scheduled_for`
  timestamp by the backend when it creates the next `scheduled_actions` row.
  n8n never runs a long `Wait` node to represent a business delay — see §5.
- **Template**: the backend resolves `workflow_steps.template_id` to a
  `message_templates` row and hands the subject/body to n8n at execution
  time. Nothing in `n8n/*.json` contains message copy.
- **Version pinning**: `workflow_runs.workflow_version_id` is fixed at
  enrollment (Rule 11 in the schema's comments) — publishing V4 while a
  lead is running V3 does not move that lead. The backend enforces this by
  construction (a run's FK points at one version row forever); n8n has no
  version concept to get wrong.

---

## 2. The 10 workflows

| # | File | Role |
|---|---|---|
| 01 | `01-due-action-worker.json` | Schedule Trigger → concurrency-safe claim → fan out |
| 02 | `02-generic-action-dispatcher.json` | Revalidate eligibility → route by `action_type` |
| 03 | `03-generic-email-executor.json` | Render + send one email, report the outcome |
| 04 | `04-generic-whatsapp-executor.json` | Render + send one WhatsApp message, report the outcome |
| 05 | `05-generic-internal-crm-action-executor.json` | Call the backend for task/stage/stop actions |
| 06 | `06-workflow-result-progression-handler.json` | Reports a result to the backend; backend advances the run |
| 07 | `07-generic-inbound-communication-handler.json` | Normalized reply → resolve lead → tell the backend |
| 08 | `08-email-webhook-adapter.json` | ESP-specific inbound webhook → normalize → 07 |
| 09 | `09-whatsapp-webhook-adapter.json` | WhatsApp provider webhook (+ verification) → normalize → 07 |
| 10 | `10-automation-error-retry-handler.json` | n8n's Error Workflow: last-resort crash safety net |

### 01 — Due Action Worker
Two triggers feed the same flow: `Schedule Trigger` (every 1 minute — the
real source of truth) and an optional `Wake Webhook` (a backend-initiated
nudge for due-now work — see §6; harmless and inert if the backend never
calls it). Either one → `Config` → `POST /automation/due-actions/claim`
→ fan out the returned array into one n8n item per claimed action →
`Execute Workflow` → **02**, once per item (n8n's default per-item
execution). The claim is a single `UPDATE ... WHERE id IN (SELECT ... FOR
UPDATE SKIP LOCKED)` statement — see §7 Concurrency.

### 02 — Generic Action Dispatcher
Receives one claimed action → **re-fetches fresh context** via
`GET /automation/actions/:id/context` (the mandatory pre-execution
recheck — see §8) → `IF eligibility.ok` → if not, `POST .../skip`; if so,
routes by `action.actionType`:
`send_email` → **03**, `send_whatsapp` → **04**, anything else → **05**.
Adding a new *business* workflow in the CRM never changes this file —
only a genuinely new *technical* action type would (see §11).

### 03 / 04 — Generic Email / WhatsApp Executor
`IF has template?` → render the template's `{{lead.field}}` tokens (plain
data substitution done in a Code node — n8n's own `{{ }}` expression syntax
never touches template bodies, since they arrive as JSON string values, not
node parameters) → **PLACEHOLDER** `HTTP Request` to your email/WhatsApp
provider (see §9 Providers) → build a `{actionId, outcome, ...}` payload →
**06**.

### 05 — Generic Internal CRM Action Executor
`POST /automation/actions/:id/execute-internal`. The backend performs
`create_call_task` / `create_follow_up_task` / `change_lead_stage` /
`stop_workflow` **and** advances the run, atomically, in one transaction —
n8n never reimplements CRM business rules. On success there is nothing
further to report; on failure, reports to **06**.

### 06 — Workflow Result / Progression Handler
`POST /automation/actions/:id/result`. All progression logic — next-step
selection, delay calculation, retry/backoff, completing the run — happens
inside `automation.service.ts`, not here. Called by 03, 04, and 05's
failure path.

### 07 — Generic Inbound Communication Handler
Receives a normalized `{leadId?, channel, fromAddress, providerMessageId?,
occurredAt?, summary}` event from 08 or 09. If `leadId` is missing, resolves
it via `GET /automation/leads/lookup?email=|phone=` (a narrow,
service-authenticated lookup — see §6). Then `POST
/automation/inbound-events`, which the backend uses to bump
`response_state`, log a timeline entry, and cancel any not-yet-sent nurture
step of the same channel (Rule: a reply invalidates stale queued nurture —
see §12 "Reply").

### 08 / 09 — Provider Webhook Adapters
All provider-specific payload parsing lives here, isolated behind a
`Normalize *` Code node, so 07 (and everything upstream of it) never sees a
provider's shape. 09 additionally handles the WhatsApp Cloud API GET
verification handshake (`hub.mode`/`hub.verify_token`/`hub.challenge`).
**Both are placeholder normalizers** — see §9.

### 10 — Generic Automation Error / Retry Handler
Set as the **Error Workflow** (Workflow Settings → Error Workflow) on the
other 9, after import. This is a last-resort net for an uncaught n8n crash
— normal provider failures never reach it, because 03/04/05 already catch
and report their own failures to 06. It makes a best-effort attempt to
recover the `actionId` from the failed execution and report a retryable
failure; if it can't, 01's stale-`executing` reclaim (§7) self-heals within
15 minutes regardless.

---

## 3. Backend changes made for this phase

There was no executor API before this phase — `scheduled_actions` was
read/cancel-only. The smallest addition that makes n8n possible:

- **`Backend/src/serviceAuthMiddleware.ts`** — `requireServiceAuth`, a
  constant-time comparison against `N8N_SERVICE_API_KEY`. Completely
  separate from `requireAuth` (salesperson Supabase sessions); n8n never
  gets a salesperson token, and this key opens nothing outside
  `/api/v1/automation`.
- **`Backend/src/services/automation.service.ts`** — all business logic:
  eligibility, claiming, internal-action execution, result/retry handling,
  inbound-event handling, contact lookup.
- **`Backend/src/routes/automation.routes.ts`** — the 6 routes listed in
  §4, mounted at `/api/v1/automation`, all behind `requireServiceAuth`.
- **`Backend/src/services/runs.service.ts`** — refactored `firstEnabledStep`
  into `nextEnabledStep(versionId, afterOrder)` and added an exported
  `scheduleStepAfter`, so enrollment (`autoEnroll`) and post-execution
  progression share one "what runs next" query instead of two.
- **`Backend/src/env.ts` / `Backend/.env.example`** — added
  `N8N_SERVICE_API_KEY`.
- Salesperson auth (`requireAuth`), every existing route, and the DB schema
  are **unchanged**.

Full endpoint list and request/response shapes: `Backend/README.md`
("Automation executor API").

---

## 4. Required configuration

### 4.1 Backend
```bash
# Backend/.env — required
N8N_SERVICE_API_KEY=$(openssl rand -hex 32)   # generate a real secret

# Backend/.env — optional (see §6 for what this is and why it's optional)
N8N_WAKE_WEBHOOK_URL=https://your-n8n-host/webhook/wake-due-actions
N8N_WAKE_WEBHOOK_SECRET=$(openssl rand -hex 32)
```
Full variable-by-variable documentation: `Backend/.env.example`.

### 4.2 n8n credentials (create these in n8n's Credentials UI — never in JSON)

| Credential name | Type | Used by | Value |
|---|---|---|---|
| `Northbeam Backend Service Key` | Header Auth (generic) | Every `/api/v1/automation/*` call (01, 02, 05, 06, 07, 10) | Header name `X-Automation-Key`, value = the same `N8N_SERVICE_API_KEY` |
| `Northbeam Wake Webhook Secret` | Header Auth (generic) | 01's `Wake Webhook` node | Header name `X-Wake-Secret`, value = the same `N8N_WAKE_WEBHOOK_SECRET` — only needed if you set that variable (§6) |
| `Email Provider API Key` | Header Auth (generic) or your ESP's native credential | 03 | Your ESP's API key — see §9 |
| `WhatsApp Provider API Key` | Header Auth (generic) or your BSP's native credential | 04 | Your WhatsApp provider's API key — see §9 |
| `Email Inbound Webhook Secret` | Header Auth (generic) | 08's Webhook node | Shared secret your ESP sends on inbound webhook calls |

None of these are invented or committed — every workflow JSON file
references credentials **by name only**, so n8n's importer either matches
an existing credential of that name or leaves the node showing "select a
credential," which you fill in once per instance.

### 4.3 Backend base URL — the one placeholder you must replace

Every workflow that calls the backend has a `Config` node at (or near) its
start containing the literal string `__NORTHBEAM_BACKEND_BASE_URL__`. This
is deliberate — it avoids relying on `$env` access inside node expressions,
which self-hosted n8n now **blocks by default**
(`N8N_BLOCK_ENV_ACCESS_IN_NODE` defaults to `true` as of n8n v2.0). Before
importing, find-and-replace `__NORTHBEAM_BACKEND_BASE_URL__` across every
file in this directory with your backend's real base URL (e.g.
`https://api.northbeam.internal`, no trailing slash):

```bash
# from the n8n/ directory
grep -rl '__NORTHBEAM_BACKEND_BASE_URL__' . | xargs sed -i 's#__NORTHBEAM_BACKEND_BASE_URL__#https://your-backend-host#g'
```

(Or edit each `Config` node's code by hand after import — same effect,
your choice.)

### 4.4 Other placeholders to replace before going live

| Placeholder | File(s) | What it is |
|---|---|---|
| `__EMAIL_PROVIDER_SEND_URL__` | 03 | Your ESP's send-email REST endpoint |
| `__WHATSAPP_PROVIDER_SEND_URL__` | 04 | Your WhatsApp provider's send-message REST endpoint |
| `__WHATSAPP_VERIFY_TOKEN__` | 09 | The webhook verify token you also set in Meta's App dashboard |

None of these are secrets in the sense of "grants access to something" on
their own (the real secrets are the credentials in §4.2) — they're
configuration values, called out explicitly rather than guessed.

### 4.5 The n8n instance's own environment

`n8n/.env.example` — copy to `.env` (or set as real env vars for your n8n
deployment/container) and fill in real values. This is a *different* layer
from §4.2–4.4: it's how the n8n **process itself** runs (webhook base URL,
credential encryption key, timezone, execution mode), not how the
workflows talk to the backend. See the comments in that file for exactly
what each variable does and why the backend base URL / service key are
deliberately *not* among them (§10 explains the `$env`-blocking reason in
full).

---

## 5. Dynamic delays (why there's no long `Wait` node anywhere)

A business delay (`workflow_steps.delay_days`) is turned into a
`scheduled_for` timestamp **by the backend**, once, when it creates a
`scheduled_actions` row (`insertScheduledAction` in `runs.service.ts`). n8n
never holds a multi-day `Wait` node open — 01 just polls every minute for
rows whose `scheduled_for <= now()`. This is what makes a delay editable
from the CRM UI with zero n8n impact: change `delay_days` on a draft step,
publish, and the *next* `scheduled_actions` row the backend creates for
that step uses the new value automatically.

---

## 6. Machine-to-machine authentication

### 6.1 n8n → Backend (required — this is how every workflow here actually works)

n8n authenticates to the backend with a single shared secret
(`X-Automation-Key`, checked with `crypto.timingSafeEqual`), stored as an
n8n **credential** (never `$env`, never inline in JSON — see §4.3 for why
`$env` was avoided even for the non-secret base URL). This key:

- Grants access to `/api/v1/automation/*` **only** — nothing else.
- Is never a Supabase session and never impersonates a salesperson.
- Does not weaken `requireAuth` in any way — that middleware, and every
  route it guards, is untouched.

If you rotate the key, update it in both `Backend/.env`
(`N8N_SERVICE_API_KEY`) and the `Northbeam Backend Service Key` n8n
credential, then restart the backend.

### 6.2 Backend → n8n (optional — a latency optimization, not a dependency)

This is the direction the question "how does the backend talk to n8n"
actually points at, and it's deliberately the **only** place the backend
initiates contact with n8n. Everywhere else in this architecture, n8n
initiates contact with the backend (§1) — the backend never needs to know
n8n is even running for automation to eventually happen.

What it's for: without it, a scheduled action that becomes due immediately
(e.g. a salesperson manually enrolls a lead, or a call outcome auto-enrolls
one straight into a same-day first step) sits until Workflow 01's next
1-minute poll. `Backend/src/services/n8nWake.ts` closes that gap with a
fire-and-forget `POST` to n8n's `Wake Webhook` node (01) whenever the
backend creates or reactivates a scheduled action that's due *right now* —
see the call sites in `Backend/src/services/runs.service.ts`
(`insertScheduledAction`, `retryRun`, `resumeRun`).

Configuration (`Backend/.env`):
```bash
N8N_WAKE_WEBHOOK_URL=https://your-n8n-host/webhook/wake-due-actions
N8N_WAKE_WEBHOOK_SECRET=$(openssl rand -hex 32)   # sent as X-Wake-Secret
```
Both are **optional** — if `N8N_WAKE_WEBHOOK_URL` is unset,
`wakeAutomationExecutor()` is a no-op and Workflow 01's poll remains the
only mechanism, exactly as if this section didn't exist. The webhook call
is never awaited by the request that triggered it and every error is
swallowed (network failure, n8n down, wrong secret) — a broken or
unconfigured wake path can only make automation ~60s slower, never break
it. On the n8n side, the `Wake Webhook` node checks the `X-Wake-Secret`
header against the `Northbeam Wake Webhook Secret` credential (§4.2) before
doing anything, so nothing external can trigger an early claim cycle.

---

## 7. Concurrency

`claimDueActions` (called by 01) runs:

```sql
UPDATE scheduled_actions
   SET status = 'executing', last_attempt_at = now()
 WHERE id IN (
   SELECT id FROM scheduled_actions
    WHERE (status IN ('pending','due') AND scheduled_for <= now())
       OR (status = 'executing' AND last_attempt_at < now() - interval '15 minutes')
    ORDER BY scheduled_for ASC
    LIMIT $1
    FOR UPDATE SKIP LOCKED
 )
 RETURNING *;
```

This single statement is atomic. Two overlapping executions of 01 (two
schedule ticks that overran, or two n8n workers in a scaled/queue-mode
deployment) can never claim the same row — the loser's `SELECT ... FOR
UPDATE SKIP LOCKED` simply skips whatever the winner already locked. The
`status = 'executing' AND last_attempt_at < now() - 15m` clause also
reclaims rows a crashed n8n execution left stranded, so a crash can't strand
an action forever without depending on workflow 10 to always fire correctly.

---

## 8. Idempotency and pre-send revalidation

Every scheduled action can be executed **at most as many times as it takes
to reach a terminal status** (`completed`/`failed`/`cancelled`/`skipped`) —
never blindly re-sent:

- **Claim → dispatch race**: 02 always calls `GET
  /automation/actions/:id/context` immediately before acting — a fresh read
  of `lifecycle_state`, `automation_mode`, run status, contactability, and
  template validity, independent of whatever was true at claim time. If the
  lead went DNC / Won / Lost / replied / etc. in that window, 02 calls
  `/skip` instead of sending.
- **Terminal lifecycle changes** (Won/Lost/Discarded/DNC/Merged) are
  cancelled at the database level, in the same transaction, by the
  `leads_cascade_lifecycle_change` trigger (see the migration, SECTION 18)
  — so a `pending`/`due` action for such a lead is never even claimable.
  The §7/§8 rechecks exist specifically for the *narrower* race after a row
  is already claimed.
- **Network failure after a successful provider send**: the executor only
  reports success once (03/04's `Build Result Payload` runs exactly once
  per execution); if the report call to 06 itself fails, n8n's own
  `retryOnFail` retries the *report*, not the *send* — the provider call
  already happened and isn't repeated. If the whole execution crashes
  before reporting, the action is left `executing` and picked up by the
  15-minute reclaim in §7, which does mean a true crash-mid-send could
  cause an at-least-once (not exactly-once) email/WhatsApp send in the
  worst case — a `scheduled_action` id is available to your ESP call as a
  natural idempotency key if your provider supports one (add it as a
  header/param in 03/04's send node).
- **`/execute-internal`** is safe to retry: it only mutates once
  `scheduled_actions.status = 'executing'`, and flips it to `completed` in
  the same statement set — a retried call after a completed one fails the
  status guard (`ConflictError`) rather than double-creating a task or
  double-advancing the run.

---

## 9. Providers

No email/WhatsApp provider credentials exist in this repository or were
invented. 03 and 04 each have exactly one placeholder `HTTP Request` node
(`Send Email via Provider` / `Send WhatsApp via Provider`) — a clean
integration boundary:

- **Option A**: point the placeholder node at your ESP/BSP's REST API
  (fill in `__EMAIL_PROVIDER_SEND_URL__` / `__WHATSAPP_PROVIDER_SEND_URL__`
  and the matching Header Auth credential).
- **Option B**: delete the placeholder node and drop in n8n's native node
  for your provider (SMTP, SendGrid, Mailgun, Twilio, WhatsApp Business
  Cloud, ...), rewiring `Render Email`/`Render WhatsApp Message` → your node
  → `Build Result Payload`. Nothing else in 03/04, or anywhere upstream,
  needs to change.

Same pattern for inbound: 08 and 09's `Normalize *` Code nodes are
placeholder parsers for a generic provider payload shape, clearly commented
with where to adjust field paths for your actual ESP/BSP (SendGrid Inbound
Parse vs. Postmark vs. Mailgun all differ; WhatsApp assumes Meta Cloud
API's `entry[].changes[].value.messages[]` shape).

---

## 10. Self-hosted configuration checklist

- **Webhook base URL**: set `WEBHOOK_URL` (or `N8N_HOST`/`N8N_PROTOCOL`/
  `N8N_PORT`) so 08/09's webhook URLs are externally reachable through
  your reverse proxy.
- **Timezone**: set `GENERIC_TIMEZONE` so `Schedule Trigger` (01) and any
  timestamp logging line up with your team's expectations. (The actual
  business delay math happens in the backend using `timestamptz`, so this
  mainly affects when 01's minute-tick fires and how times are displayed.)
- **`N8N_BLOCK_ENV_ACCESS_IN_NODE`**: left at its secure default (`true`);
  this design deliberately never needs `$env` in a node — see §4.3.
- **Payload size**: default `N8N_PAYLOAD_SIZE_MAX` (16MB) is far more than
  a webhook/CRM payload needs; no change required.
- **Execution/concurrency**: if you expect a large lead volume, consider
  n8n's queue mode (`EXECUTIONS_MODE=queue`) and
  `N8N_CONCURRENCY_PRODUCTION_LIMIT` — this design assumes nothing about
  single- vs. multi-worker deployment, since §7's `SKIP LOCKED` claim is
  safe either way.

---

## 11. What requires editing n8n (and what never does)

| Change | Requires n8n edit? |
|---|---|
| Change a nurture sequence / add a new business workflow | **No** — CRM only |
| Change a step's delay | **No** — CRM only |
| Change a template's copy | **No** — CRM only |
| Reorder / enable / disable steps | **No** — CRM only |
| Publish a new workflow version | **No** — CRM only |
| Change a workflow's trigger mapping | **No** — CRM only |
| Add a genuinely new technical action type (e.g. "Send SMS") | **Yes** — add a new executor workflow + a new `IF`/route branch in 02, plus the matching backend support |
| Switch email/WhatsApp provider | **Yes, but only inside 03/04** — swap the placeholder send node; nothing else changes |
| Rotate the backend service key | **Yes** — update the `Northbeam Backend Service Key` credential |
| Rotate the wake webhook secret (if you use §6.2) | **Yes** — update the `Northbeam Wake Webhook Secret` credential |

---

## 12. Import order, activation order, and testing

### Import order
1. In n8n: **Workflows → Import from File**, import all 10 files
   (order doesn't matter for the import step itself, since sub-workflow
   references resolve by picking from a dropdown, not by pre-wired ID).
2. For every `Execute Workflow` node (in 01, 02, 03, 04, 05, 08, 09), open
   it and select the correct target workflow from the `workflowId`
   dropdown. **This step is unavoidable and must be done by hand** — n8n
   assigns a new workflow ID on every import, so no file can know another
   workflow's ID in advance. The `cachedResultName` already shown on each
   node tells you which workflow to pick.
3. Create the credentials in §4.2, then open every `HTTP Request`/`Webhook`
   node that shows "select a credential" and pick the right one.
4. Find-and-replace the placeholders in §4.3–4.4.
5. Open workflow **10**, note its workflow ID/name, then open each of the
   other 9 workflows' **Settings → Error Workflow** and set it to 10.

### Activation order
Activate in this order so nothing tries to call a not-yet-active
sub-workflow's *trigger*-only path prematurely (sub-workflow calls work
regardless of the target's active state via Execute Workflow, but keep
this order for a clean rollout and easy testing):
1. **06** (Result/Progression Handler) — no dependencies.
2. **03, 04, 05** — depend on 06.
3. **02** (Dispatcher) — depends on 03/04/05.
4. **01** (Due Action Worker) — depends on 02. Activating this starts the
   live minute-tick poll — activate it last, once everything downstream is
   verified.
5. **07** — no dependency on 01–06.
6. **08, 09** (webhook adapters) — depend on 07. Activating these exposes
   the public webhook URLs; register them with your providers only after
   activation.
7. **10** (error handler) — activate any time before step 5's Error
   Workflow assignment takes effect.

### The critical acceptance test (dynamic behavior, not just execution)

1. Publish a workflow version V1 with 2 steps (e.g. wait 1 day → send
   email; wait 1 day → create a call task). Enroll a test lead. Let 01/02/03
   run it (or advance `scheduled_for` manually in the DB for a fast test).
   Confirm the email sends and the run advances to the task step.
2. **Without touching any file in this directory**, publish V2 on the same
   workflow with a different sequence (e.g. WhatsApp first, then a
   different email, then a follow-up task).
3. Enroll a **new** test lead. Confirm it follows V2.
4. Confirm the **original** lead's already-running V1 enrollment is
   unaffected (`workflow_runs.workflow_version_id` still points at V1) —
   it keeps executing V1's remaining steps, not V2's.

If step 4 fails (the old run somehow starts following V2), that's a
backend bug, not an n8n one — n8n has no version awareness to get wrong;
it only ever asks "what's the context for scheduled_action X" and acts on
the answer.

### Also test
- **Wake path (if configured)**: with `N8N_WAKE_WEBHOOK_URL` set and 01
  activated, manually enroll a lead into a workflow whose first step has
  `delay_days = 0`. Confirm the action executes within a second or two,
  not up to a minute later. Then unset `N8N_WAKE_WEBHOOK_URL`, restart the
  backend, repeat — confirm it still executes, just on the next poll tick,
  proving the wake path is genuinely optional.
- **DNC mid-run**: mark a lead DNC while it has a pending scheduled action
  → the DB trigger cancels it immediately; confirm nothing sends.
- **Won mid-run**: same, via `markWon`.
- **Pause/Resume**: pause a run, wait past its `next_run_at`, resume — 06
  reads `applyAutomationModeToRuns`' existing pause/resume handling;
  confirm resume does not "catch up" and blast every missed step at once
  (it doesn't: pausing/resuming a scheduled action never changes its
  `scheduled_for`, it only flips `status` between `paused`/`pending`).
- **Two workers, one action**: run two manual executions of 01
  simultaneously against a small due-actions queue; confirm the count of
  actions that flip to `executing` equals the number of due rows, not
  double.
- **Provider failure then success**: force 03's send node to fail once
  (e.g. point it at an invalid URL temporarily); confirm a retry gets
  scheduled with backoff (`scheduled_actions.attempt_count` increments,
  `scheduled_for` moves forward) and eventually succeeds once fixed.
- **Retries exhausted**: force repeated failure past `max_attempts`;
  confirm `scheduled_actions.status = 'failed'` and
  `workflow_runs.status = 'failed'`.
- **Reply**: call `POST /automation/inbound-events` (via 07/08/09, or
  directly for a quick test) for a lead with a pending `send_email`/
  `send_whatsapp` step; confirm that step is cancelled with reason "Lead
  replied — nurture step invalidated" and a timeline entry is written.

---

## 13. What was actually validated vs. what needs testing on your instance

**Validated in this repository:**
- All 10 files are syntactically valid JSON.
- Every `connections` entry references a node that actually exists in the
  same file; no orphaned/unreachable nodes; no duplicate node ids.
- Every `Execute Workflow` node's `cachedResultName` matches the `name` of
  one of the other 9 files.
- The backend endpoints these workflows call
  (`Backend/src/routes/automation.routes.ts`) pass `tsc --noEmit`,
  `eslint`, and the existing unit test suite unmodified.
- The overall node/connections JSON shape, `HTTP Request`/`IF`/`Code`/
  `Execute Workflow`/`Execute Workflow Trigger`/`Schedule Trigger`
  parameter shapes used here match n8n's long-stable, widely-documented
  format.

**Needs verification against your live self-hosted n8n version** (current
official docs at the time of writing had reorganized URLs and several pages
returned 404s or only partial detail, so treat these as the residual
uncertainty, not the whole design):
- Exact current `typeVersion` numbers for each node type — n8n generally
  imports an older/newer `typeVersion` fine and flags the node for a
  version-bump in the UI rather than failing the import, but confirm this
  on your instance.
- The Webhook node's `httpMethod` as an array (`["GET","POST"]`, used in
  09) — if your version only accepts a single method string, split it into
  two Webhook nodes on the same path as noted in that file.
- The `Execute Workflow` node's exact per-item vs. all-items iteration
  field name — this design relies on n8n's default (a node with N input
  items runs once per item), which should hold, but confirm 01 actually
  invokes 02 once per claimed action rather than once with all of them
  batched together.
- `retryOnFail`/`maxTries`/`waitBetweenTries`/`onError` node-level fields
  (used in 03/04/05's HTTP Request nodes) — confirm your version reads
  these; if not, use the node's Settings panel (gear icon) to set "Retry On
  Fail" and "On Error" interactively after import, which writes the same
  fields.
- End-to-end provider send/receive, obviously — 03/04/08/09 contain
  placeholder integration points by design (§9) and cannot be tested until
  you wire in real provider credentials.
