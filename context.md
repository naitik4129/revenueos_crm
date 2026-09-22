# Northbeam CRM - Project Context

Last refreshed: 2026-09-07

## Project Summary

Northbeam CRM is a full-stack lead management and sales automation app for MOTM/Northbeam-style business development workflows. It is a React SPA backed by an authenticated Express/Postgres API, with Supabase providing Auth, Postgres, and private Storage buckets. The app no longer uses frontend seed data or in-memory CRM slices for production behavior.

The trusted architecture is:

```text
Browser SPA -> Backend API -> Supabase Postgres/Auth/Storage
                         -> Worker -> Email / WhatsApp / Google Calendar providers
```

Supabase JS in the frontend is used only for browser authentication and session management. All CRM data reads, writes, IDs, timestamps, business transitions, audit activity, and provider orchestration go through `Backend/`.

## Repository Layout

- `Frontend/`: React 19, Vite 8, TanStack Router, TanStack Query, Tailwind CSS 4, Radix UI, lucide icons, Tiptap template editing, PapaParse CSV import, QR code rendering, and Vitest tests.
- `Backend/`: Node 22 TypeScript ESM, Express, `pg`, Zod validation, Supabase admin auth/storage client, provider integrations, pure domain routing modules, service-layer transactions, API routes, automation worker, and Vitest tests.
- `Supabase/migrations/`: ordered SQL migrations. Apply every file in filename order, currently `001_initial_migration.sql` through `014_meeting_agreed_call_outcome.sql`.
- `Supabase/disposable/`: one-off SQL seed scripts (not tracked as migrations, not idempotent) that create workflows/templates/steps. Run once by hand after the migrations they depend on. Currently: `stage1_welcome_workflow_seed.sql` (the new-lead welcome sequence) plus 14 further nurture sequences — `not_connected_reconnect_seed.sql`, `interested_later_seed.sql`, `future_possibility_seed.sql`, `send_information_seed.sql`, `objection_commission_only_seed.sql`/`objection_internal_hiring_seed.sql`/`objection_existing_team_seed.sql`/`objection_budget_price_seed.sql`/`objection_internal_approval_seed.sql`, `meeting_needs_more_info_seed.sql`/`meeting_not_ready_seed.sql`, `proposal_conversion_seed.sql`, and `reactivation_price_budget_seed.sql`/`reactivation_internal_hiring_seed.sql` (illustrative — the same pattern extends to the other loss reasons via the Automations UI). Every template contains real MOTM copy with `[PROOF NEEDED: ...]` markers wherever a specific case study, testimonial, or number must come from the business, not be fabricated.
- `compose.yaml`: production-style three-service Docker Compose setup for `backend`, `worker`, and `frontend`.
- `.env.example`: root Compose environment example. `Backend/.env.example` and `Frontend/.env.example` document local service env values.

## Runtime Services

- `backend`: Express API on port `8787` by default. Exposes `/health` and authenticated `/api/v1/*` routes.
- `worker`: separate Node process using the same backend image and `node dist/src/worker.js`. It polls due scheduled workflow actions, queued proposal WhatsApp sends, and queued meeting WhatsApp notifications.
- `frontend`: static Vite build served by nginx on container port `8080`.

In Compose, frontend config is baked at build time via `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_API_BASE_URL`. Backend and worker share `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and one stable `INTEGRATION_ENCRYPTION_KEY`.

## Authentication And Authorization

Authentication starts in Supabase Auth. Every backend request with business data presents `Authorization: Bearer <supabase-access-token>`.

`Backend/src/authMiddleware.ts` verifies the bearer token with `supabaseAdmin.auth.getUser(token)`, then loads the matching row from `public.profiles`. Disabled accounts are rejected even if their Supabase session is still valid.

Roles are intentionally separated:

- `admin`: can access `/api/v1/admin/*` and `/api/v1/me`; cannot access CRM business routes.
- `salesperson`: can access CRM business routes such as leads, tasks, meetings, proposals, workflows, dashboard, notifications, and profiles; cannot access admin routes.

The backend connects to Postgres with a role that bypasses RLS, then enforces authorization and attribution in code. RLS remains enabled on tables as defense in depth for non-backend clients.

## Database And Migrations

The migration files are the schema source of truth. The current migration stack includes:

- `001_initial_migration.sql`: core enums, profiles, leads, notes, contact channels, calls, tasks, meetings, proposals, message templates, workflows, workflow versions/steps/runs, scheduled actions, timeline events, DNC events, notifications, RLS policies, update triggers, auth-profile trigger, terminal automation enforcement, and lifecycle cascade behavior.
- `002_fix_bugs_and_constraints.sql`: fixes lifecycle cascade behavior, adds workflow/scheduled-action constraints, and adds indexes for workflow templates, task source steps, timeline related IDs, and notification lead lookup.
- `003_admin_integrations_baileys.sql`: adds `profiles.role`, admin/salesperson profile access helpers, `leads.phone_e164`, admin integration tables, encrypted WhatsApp connection state, Baileys auth credentials/keys, outbound WhatsApp messages, inbound WhatsApp events, and admin audit events.
- `004_template_attachments.sql`: replaces single template attachment text with private Supabase Storage bucket `template-attachments` and `public.template_attachments`.
- `005_proposal_send.sql`: adds private `proposal-documents` storage metadata, proposal email/WhatsApp template references, send statuses, WhatsApp proposal queue fields, and outbound message linkage to proposals.
- `006_google_calendar_meeting_sync.sql`: adds encrypted Google Calendar connection state, meeting calendar event/Meet link/sync status fields, meeting participants, default meeting-scheduled templates, meeting notification send statuses, queued WhatsApp notification fields, and outbound message linkage to meetings.
- `007_lead_hard_delete.sql`: adds permanent lead delete policy and `deleted_leads_audit`.
- `008_meeting_outcome_won.sql`: adds `won` to `public.meeting_outcome`.
- `009_lead_created_trigger.sql`: adds `lead_created` to `public.workflow_trigger`; single lead creation and CSV import can auto-enroll new leads immediately.
- `010_status_enums.sql`: richer lead-nurturing enum growth — adds `interested_later`, `future_possibility`, `commission_only`, `internal_hiring`, `existing_team`, `budget_price`, `internal_approval`, `wrong_fit` to `call_connected_outcome`; `connected_qualifying`, `interested_later`, `future_possibility`, `objection_nurture`, `negotiation` to `pipeline_stage`; `highly_interested`, `needs_internal_discussion`, `needs_more_information` to `meeting_outcome`; and 10 new nurture-sequence values to `workflow_trigger`. Additive only — `maybe`/`negative`/`maybe_nurture`/`negative_nurture`/`call_outcome_maybe`/`call_outcome_negative` remain in Postgres (can't be cheaply dropped) but are retired from the application layer.
- `011_objection_and_loss_types.sql`: adds `public.objection_type` and `public.lead_loss_reason` enums.
- `012_lead_fields.sql`: adds `leads.objection_type`, the four `leads.interested_later_*` capture columns, and `leads.loss_reason`/`loss_notes`, plus `leads_lost_has_reason` and `leads_objection_stage_has_type` constraints.
- `013_proposal_loss_fields.sql`: adds `proposals.loss_reason`/`loss_notes` (captured on `rejected`/`expired`, since those don't move the lead to `lost`).
- `014_meeting_agreed_call_outcome.sql`: adds `meeting_agreed` to `public.call_connected_outcome` and `public.workflow_trigger`.
- `015_workspaces.sql`: introduces `public.workspaces` and `workspace_id` scoping across the CRM.
- `016_meeting_outcome_triggers.sql`: adds `meeting_highly_interested`, `meeting_proposal_requested`, `meeting_not_a_fit` to `public.workflow_trigger` — dedicated triggers for those three meeting outcomes, which previously had none.

Private Supabase Storage buckets currently used by the backend:

- `template-attachments`: template attachment uploads and downloads for email/WhatsApp automation.
- `proposal-documents`: uploaded proposal documents sent by email and WhatsApp.

## Backend Architecture

Backend layout:

- `src/env.ts`: API environment validation.
- `src/workerEnv.ts`: worker poll/batch/dry-run validation.
- `src/db.ts`: `pg` pool and `withTransaction()` helper.
- `src/supabaseAdmin.ts`: server-only Supabase admin client for auth verification and Storage.
- `src/authMiddleware.ts`: token verification, profile lookup, active-account enforcement, admin/salesperson gates.
- `src/errors.ts` and `src/errorMiddleware.ts`: typed API errors and JSON error envelopes.
- `src/domain/*`: pure business rules, unit tested, no I/O.
- `src/services/*`: SQL, orchestration, transactions, timeline/audit writes, provider orchestration.
- `src/routes/*`: thin Express routers that validate input and call services.
- `src/worker.ts`: polling executor for scheduled actions and queued sends.
- `src/providers/*`: email, Google Calendar, WhatsApp/Baileys, encrypted Baileys auth store, and provider error types.

Errors are returned as:

```json
{ "error": { "code": "string", "message": "string", "details": {} } }
```

Known error codes include `invalid_input`, `authentication_failed`, `forbidden`, `not_found`, `conflict`, `do_not_contact`, `invalid_transition`, and `internal_error`.

## Backend API Surface

All routes below are mounted under `/api/v1`.

Identity and admin:

- `GET /me`
- `GET /profiles`
- `GET /admin/users`
- `POST /admin/users`
- `PATCH /admin/users`
- `PATCH /admin/users/:id`
- `GET /admin/connections/email`
- `PUT /admin/connections/email`
- `POST /admin/connections/email/test`
- `GET /admin/connections/whatsapp/settings`
- `PUT /admin/connections/whatsapp/settings`
- `POST /admin/connections/whatsapp/connect`
- `POST /admin/connections/whatsapp/restart`
- `POST /admin/connections/whatsapp/logout`
- `GET /admin/connections/google-calendar`
- `PUT /admin/connections/google-calendar/credentials`
- `POST /admin/connections/google-calendar/oauth/start`
- `GET /admin/connections/google-calendar/oauth/callback`
- `POST /admin/connections/google-calendar/disconnect`

Leads and lead sub-resources:

- `GET /leads`
- `POST /leads`
- `POST /leads/import`
- `GET /leads/:id`
- `PATCH /leads/:id`
- `DELETE /leads/:id`
- `GET /leads/:id/notes`
- `POST /leads/:id/notes`
- `POST /leads/:id/automation`
- `POST /leads/:id/dnc`
- `POST /leads/:id/dnc/reactivate`
- `POST /leads/:id/won`
- `POST /leads/:id/lost` (requires `lossReason`; `notes` optional)
- `POST /leads/:id/discard`
- `POST /leads/:id/long-term-nurture` (rep-initiated parking action)
- `POST /leads/:id/reactivate`
- `POST /leads/:id/merge`
- `GET /leads/:id/contactability`
- `POST /leads/:id/contactability`
- `GET /leads/:id/calls`
- `POST /leads/:id/calls`
- `POST /leads/:id/communications`
- `GET /leads/:id/timeline`
- `GET /leads/:id/meetings`
- `GET /leads/:id/proposals`
- `GET /leads/:id/runs`

Tasks, meetings, proposals, workflows, runs, dashboard, notifications:

- `GET /tasks`, `POST /tasks`, `PATCH /tasks/:id`, `POST /tasks/:id/complete`, `POST /tasks/:id/cancel`
- `GET /meetings`, `POST /meetings`, `PATCH /meetings/:id`, `POST /meetings/:id/outcome`
- `GET /proposals`, `POST /proposals`, `PATCH /proposals/:id`, `POST /proposals/:id/status`
- `GET /workflows`, `POST /workflows`, `GET /workflows/:id`, `PATCH /workflows/:id`, `POST /workflows/:id/draft`, `PUT /workflows/:id/versions/:version/steps`, `POST /workflows/:id/versions/:version/publish`, `POST /workflows/:id/duplicate`, `DELETE /workflows/:id`
- `GET /templates`, `POST /templates`, `PATCH /templates/:id`, `DELETE /templates/:id`, `POST /templates/:id/attachments`, `DELETE /templates/:id/attachments/:attachmentId`
- `GET /runs`, `POST /runs`, `POST /runs/:id/pause`, `POST /runs/:id/resume`, `POST /runs/:id/cancel`, `POST /runs/:id/retry`
- `GET /scheduled-actions`
- `GET /dashboard/summary`
- `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all`

## Domain Model

Important enum concepts are intentionally separate:

- Pipeline stages: `new`, `ready_for_first_call`, `contact_attempted`, `not_connected_nurture`, `connected_qualifying`, `interested_later`, `future_possibility`, `objection_nurture`, `meeting_scheduling`, `meeting_scheduled`, `meeting_follow_up`, `proposal_preparation`, `proposal_sent`, `proposal_decision_pending`, `negotiation`. (`maybe_nurture`/`negative_nurture` still exist in Postgres but are retired from application code — see migration `010`.)
- Lifecycle states: `active`, `long_term_nurture`, `won`, `lost`, `discarded`, `do_not_contact`, `merged`.
- Automation modes: `active`, `paused`, `manual`, `stopped`.
- Response states: `no_response`, `responded`, `conversation_active`, `waiting_on_customer`, `waiting_on_us`.
- Contact channels: `phone`, `email`, `whatsapp`, each with channel-specific status values.
- Objection type (set alongside `pipeline_stage = objection_nurture`): `commission_only`, `internal_hiring`, `existing_team`, `budget_price`, `internal_approval`, `wrong_fit`.
- Lead loss reason (required when `lifecycle_state = lost`, or on a proposal `rejected`/`expired`): `price_budget`, `internal_hiring`, `project_postponed`, `competitor_selected`, `management_rejected`, `no_urgency`, `no_response`, `other`.
- Workflow triggers: `lead_created`, `meeting_agreed`, `call_not_connected`, `call_outcome_interested_later`, `call_outcome_future_possibility`, `call_outcome_information_requested`, `objection_commission_only`, `objection_internal_hiring`, `objection_existing_team`, `objection_budget_price`, `objection_internal_approval`, `meeting_needs_more_information`, `meeting_not_ready`, `meeting_highly_interested`, `meeting_proposal_requested`, `meeting_not_a_fit`, `proposal_pending`, `manual_enrollment`. (`call_outcome_maybe`/`call_outcome_negative` retired — see migration `010`.)
- Workflow step actions: `send_email`, `send_whatsapp`, `create_call_task`, `create_follow_up_task`, `change_lead_stage`, `stop_workflow`.

Backend values stay lowercase. Friendly labels are presentation-only and generated in `Frontend/src/lib/labels.ts`.

## Business Rules Owned By Backend

The backend owns all transitions, side effects, and audit/timeline writes. UI mutations send intent and invalidate queries; they do not duplicate backend routing tables.

Call routing (the Human Call Classification disposition table):

- Not connected moves to `not_connected_nurture`, keeps automation active, creates a retry call task, and enrolls `call_not_connected`.
- `invalid_number` and `wrong_number` also update phone contactability without marking the whole lead terminal.
- Positive moves to `meeting_scheduling`, sets automation `manual`, creates a schedule-meeting task, and prompts for meeting scheduling.
- Interested - Later moves to `interested_later`, captures the reason/restart date/next action/decision owner fields onto the lead, creates a follow-up task due 7 days before the captured restart date (falls back to 30 days with no date), and enrolls `call_outcome_interested_later`.
- Future Possibility moves to `future_possibility`, keeps automation active, creates a 90-day low-intensity check-in task, and enrolls `call_outcome_future_possibility`.
- Information requested ("Send Me Details First") moves to `connected_qualifying`, keeps automation active, creates a 10-day "gauge relevance" call task, and enrolls `call_outcome_information_requested`.
- Each of the 5 objection outcomes (`commission_only`, `internal_hiring`, `existing_team`, `budget_price`, `internal_approval`) moves to `objection_nurture`, sets the matching `objection_type`, and enrolls its own `objection_*` trigger.
- Wrong Fit (irrelevant company) records `objection_type = 'wrong_fit'` for reporting without changing stage or enrolling any nurture — a rep manually decides Archive vs. reroute. Kept distinct from Wrong Person (right company, wrong contact), which moves to `connected_qualifying` and preserves history while the rep finds the correct contact — a deliberate refinement.
- Callback requested creates a manual callback task at the requested time and does not change stage.
- Do-not-contact uses the shared DNC path, not ordinary routing.

Meeting routing (the Post-Meeting / Demo Nurture outcome table):

- Scheduling a meeting saves participants, attempts Google Calendar sync outside the transaction, then sends/queues meeting-scheduled notifications.
- Cancellation attempts calendar cleanup/reschedule sync outside the transaction.
- `highly_interested` moves to `proposal_preparation`, creates a proposal/solution-discussion task, and enrolls `meeting_highly_interested`.
- `proposal_required` moves to `proposal_preparation`, creates a prepare-proposal task, and enrolls `meeting_proposal_requested`.
- `needs_internal_discussion` moves to `objection_nurture` with `objection_type = 'internal_approval'`, creates a one-pager task, and enrolls `objection_internal_approval` — reusing the same track as the call-stage Internal Approval objection.
- `needs_more_information` moves to `meeting_follow_up`, creates a send-case-study task, and enrolls `meeting_needs_more_information`.
- `follow_up_required` ("Not ready") moves to `meeting_follow_up`, creates a follow-up task, and enrolls `meeting_not_ready`.
- `second_meeting` moves back to `meeting_scheduling` and creates a scheduling task.
- `not_interested` ("Not fit") moves lifecycle to `long_term_nurture`, creates a re-engagement task, and enrolls `meeting_not_a_fit` — deliberately not `discarded`, per this module's existing "don't invent aggressive/automatic behavior" philosophy; a rep can still Discard explicitly.
- `no_proposal_required` creates an internal-review task.
- `won` moves lifecycle to `won` and cancels open tasks via lead lifecycle handling.

Proposal routing (the Proposal Conversion Funnel and loss-reason taxonomy):

- Creating a proposal requires a document upload plus email and WhatsApp template IDs.
- The document is uploaded to `proposal-documents`.
- Email send is attempted immediately through the configured email provider.
- WhatsApp send is queued for the worker.
- `sent` moves to `proposal_decision_pending`, creates a proposal follow-up task, and enrolls `proposal_pending` (the Day 2/4-5/7/10/14 follow-up cadence).
- `revision_requested` moves back to `proposal_preparation`, creates a revision task, and cancels open proposal follow-ups.
- `accepted` moves lifecycle to `won` and cancels all open tasks.
- `rejected` and `expired` require a `lossReason` (persisted on the proposal, not forced onto the lead since lifecycle only moves to `long_term_nurture`) and create re-engagement tasks.
- `draft`, `uploaded`, `ready_to_send`, `revised`, and `withdrawn` record status only.

Lead lifecycle and safety:

- DNC suppresses automation and inappropriate future actions while preserving history.
- Reactivating from DNC requires a reason and preserves DNC history.
- Terminal lifecycle states freeze inappropriate pipeline edits and cancel/stop automation as defined by services/triggers.
- Lead merge preserves relationships by moving source lifecycle to `merged` and pointing at a target.
- Permanent delete removes the lead and related CRM records, and writes `deleted_leads_audit`.
- Manual email/WhatsApp communication buttons persist audit/timeline activity only; they do not send provider messages.

## Automation Worker

`Backend/src/worker.ts` is the only executor. It is deliberately thin and calls service functions for eligibility, retry/backoff, timeline writes, run advancement, and scheduled-step decisions.

On each tick it:

- Claims due `scheduled_actions` with transaction-safe locking.
- Rechecks lead lifecycle, DNC, automation mode, contactability, response state, workflow run state, and template resolution.
- Executes internal actions directly (`create_call_task`, `create_follow_up_task`, `change_lead_stage`, `stop_workflow`).
- Renders email/WhatsApp templates for message actions.
- Sends email through configured Resend or SMTP.
- Sends WhatsApp through the singleton Baileys socket.
- Records success, failure, deferred retry, or skipped outcomes.
- Advances workflow runs to their next enabled step or completes/stops them.
- Claims queued proposal WhatsApp sends.
- Claims queued meeting WhatsApp notifications.

`WORKER_DRY_RUN=true` renders/logs messages and advances runs as if the send succeeded, without contacting providers.

## Integrations

Email:

- Admin can configure Resend or TLS/STARTTLS SMTP from Admin -> Connections.
- Secrets are write-only in the UI and encrypted in Postgres.
- Empty secret fields retain existing saved values.
- `RESEND_API_KEY` plus sender env vars are an optional legacy read-only fallback until database email settings are saved.
- Email can be globally disabled by admins; sends then defer.

WhatsApp:

- Uses Baileys, an unofficial WhatsApp Web client.
- One worker owns one shared socket guarded by a PostgreSQL advisory lock.
- Admin controls connect/restart/logout, outbound enabled switch, and daily cap.
- QR codes are encrypted, admin-only, and short-lived.
- Baileys credentials and Signal keys are encrypted in Postgres.
- Outbound messages support workflow scheduled actions, proposal sends, and meeting notification sends.
- Sends respect an emergency switch, live connection state, WhatsApp reachout/new-chat restrictions, recipient registration, randomized send spacing, and Asia/Kolkata daily cap.
- Inbound direct replies store metadata only, never message body content, and atomically stop matching lead automation. Ambiguous/unmatched replies appear for admin review.
- Protocol and account-enforcement risk remains because Baileys is unofficial.

Google Calendar:

- Admin enters OAuth client ID, client secret, and redirect URI in Admin -> Connections; credentials are encrypted in Postgres, not read from env.
- OAuth callback is unauthenticated by route placement but protected by generated state.
- Connected calendar defaults to `primary`.
- CRM meeting creation creates a Google Calendar event, asks Google for a Meet link, and invites participants.
- Reschedule/cancel attempts patch/delete of the calendar event.
- Calendar sync is best-effort and must not roll back a saved CRM meeting.

## Frontend Architecture

Frontend routes are generated by TanStack Router and currently include:

- `/`: Dashboard
- `/leads`: Leads table and CSV import
- `/leads/$leadId`: Lead detail workspace
- `/tasks`: Task queue
- `/meetings`: Meetings
- `/proposals`: Proposals
- `/automations`: Workflows overview
- `/automations/workflows/$workflowId`: Workflow builder
- `/automations/templates`: Templates and attachments
- `/automations/runs`: Workflow runs
- `/admin`: Admin users and integration connections

Important frontend boundaries:

- `Frontend/src/lib/backend-client.ts` is the only CRM HTTP client. It validates config, gets the Supabase session, attaches the bearer token, supports abort signals, uploads multipart files where needed, normalizes API/network errors, and clears the local session on HTTP 401.
- `Frontend/src/store/server-hooks.ts` owns TanStack Query hooks and mutations.
- `Frontend/src/store/query.ts` owns query keys and composite invalidation.
- `Frontend/src/store/store-provider.tsx` is intentionally a compatibility pass-through.
- `Frontend/src/types` mirrors backend-authoritative lowercase contracts.
- `Frontend/src/lib/dates.ts` and `Frontend/src/lib/format.ts` handle Asia/Kolkata display/form conversion.
- Missing or invalid frontend config renders a visible configuration error. There is no demo-data fallback.

User-visible product areas:

- Dashboard cards for active leads, due tasks/calls, meetings today, proposal follow-ups, overdue actions, attention items, pipeline funnel, and today's queue.
- Leads page with search, owner/stage/automation filters, add lead, CSV import, missing-next-action warning, and next-action visibility that includes scheduled automation steps.
- Lead detail with journey card, call logging, next action creation/rescheduling/completion, lead editing, permanent delete, DNC/reactivation, lifecycle actions, contactability, owner/stage/response edits, open tasks, timeline, meetings, proposals, workflow runs, scheduled actions, and notes.
- Task page for open/completed/cancelled task management.
- Meetings page for scheduling/updating meetings, participants, status/outcome recording, calendar sync visibility, and Meet links.
- Proposals page for document upload, template selection, send status, and status transitions.
- Automations area for workflows, runs, scheduled actions, templates, template body editing, template attachments, default meeting-scheduled templates, draft versions, step ordering, debounce autosave, publish, duplicate, delete, pause/resume/cancel/retry.
- Admin page for salesperson account creation/update/deactivation and email, WhatsApp, and Google Calendar connection control.

## Time, Locale, And Data Transport

All persisted timestamps are UTC ISO strings. Forms and display use the Asia/Kolkata business timezone. Backend due-today/dashboard aggregation and WhatsApp daily caps also use Asia/Kolkata day boundaries.

Phone handling normalizes valid Indian local numbers to `+91` E.164 and accepts explicit international numbers when unambiguous.

## Configuration

Frontend required values:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE_URL`

Backend required values:

- `PORT` (defaults to `8787`)
- `CORS_ORIGINS`
- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `INTEGRATION_ENCRYPTION_KEY` as a base64-encoded 32-byte AES key
- `NODE_ENV`

Worker/provider values:

- `RESEND_API_KEY` optional fallback
- `SMTP_FROM_NAME`
- `SMTP_FROM_ADDRESS`
- `WORKER_POLL_INTERVAL_MS`
- `WORKER_BATCH_SIZE`
- `WORKER_DRY_RUN`

`INTEGRATION_ENCRYPTION_KEY` must be generated once, shared by API and worker, and kept stable. Rotating it requires an explicit re-encryption procedure.

## Development Commands

Backend:

```bash
cd Backend
npm ci
npm run dev
npm run worker:dev
npm run typecheck
npm run lint
npm run test:run
npm run test:unit
npm run test:integration
npm run build
npm run check
```

Frontend:

```bash
cd Frontend
npm ci
npm run dev
npm run format:check
npm run lint
npm run typecheck
npm run test:run
npm run build
npm run check
```

Docker Compose:

```bash
docker compose build
docker compose up
```

## Verification Status

The repository has automated coverage for:

- Backend domain routing for calls, meetings, proposals, lifecycle/pipeline guards, template rendering, HTML-to-WhatsApp conversion, import validation, encryption, phone/JID mapping, and Baileys policy.
- Backend integration business flows behind `TEST_DATABASE_URL`, including create lead, call routing, DNC cascade, manual communication, tasks, meeting/proposal routing, won meeting outcome, meeting cancellation, workflow immutability, chosen-workflow enrollment, and partial CSV import.
- Frontend backend-client behavior, multipart proposal upload, retained admin email secrets, 401 handling, presentation helpers, query invalidation, and route smoke tests for zero-record states.

Integration tests skip when `TEST_DATABASE_URL` is absent. A full login-to-persistence proof still requires real Supabase Auth, the migrated Postgres database, private Storage buckets, configured backend/worker/frontend env values, and provider credentials or dry-run settings.

## Production Rollout Notes

1. Apply all migrations in filename order.
2. Set one stable `INTEGRATION_ENCRYPTION_KEY` on both API and worker.
3. Create the first Supabase Auth user, then promote it:

```sql
update public.profiles set role = 'admin' where email = 'admin@example.com';
```

4. Deploy with outbound email and WhatsApp disabled.
5. Configure and test Email in Admin -> Connections.
6. Configure Google Calendar OAuth and verify a test meeting creates/updates/cancels an event with participants and a Meet link.
7. Pair a dedicated, opted-in WhatsApp account and verify worker restart reconnects without a second QR.
8. Send one internal/opted-in email and WhatsApp message, reply on WhatsApp, and confirm automation is stopped without reply content being stored.
9. Enable WhatsApp outbound only after cap, heartbeat, connection status, restriction state, and pending counts look healthy.

Rollback starts by disabling WhatsApp outbound and pausing workflows/runs as needed. Migrations are additive; scheduled actions and provider state remain in Postgres/Storage unless explicitly cleaned up.

## Non-Negotiable Project Boundaries

- Do not reintroduce frontend fixture/demo data for production CRM flows.
- Do not bypass Supabase Auth or trust client-supplied user IDs.
- Do not put service-role keys, provider secrets, encryption keys, or SMTP credentials in the frontend.
- Do not duplicate business routing tables in React.
- Do not send provider messages from manual Email/WhatsApp activity buttons.
- Do not execute workflow sends in request/response handlers; use the worker.
- Do not store inbound WhatsApp message bodies.
- Do not treat pipeline stage and lifecycle state as interchangeable.
- Do not edit published workflow versions; create a draft and publish a new version.
- Do not rotate `INTEGRATION_ENCRYPTION_KEY` casually.
- Do not skip migrations or apply only `001_initial_migration.sql`; the latest project needs migrations `001` through `013`.
