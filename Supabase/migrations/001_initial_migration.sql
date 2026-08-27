-- =============================================================================
-- Northbeam CRM — 001_initial_migration
--
-- Complete Supabase foundation for a fresh project: extensions, enums,
-- salesperson profiles (Supabase Auth integration), the full CRM schema
-- (leads, notes, contact channels, calls, tasks, meetings, proposals,
-- message templates, workflows/versions/steps, workflow runs, scheduled
-- automation actions, timeline/audit log, DNC history, notifications),
-- cross-cutting lifecycle/automation integrity triggers, and read-only
-- dashboard views.
--
-- This file is intentionally a single migration so the whole schema applies
-- as one atomic, ordered unit on a fresh database. Future schema changes
-- should be added as new migration files (002_..., 003_..., ...) rather
-- than editing this one, so history stays linear and re-runnable.
--
-- Sections below are ordered so every reference (foreign key, trigger,
-- policy) only ever points at something already created earlier in the
-- file.
-- =============================================================================


-- =============================================================================
-- SECTION 1 — Extensions and shared trigger helpers
-- =============================================================================

-- Northbeam CRM — foundation: extensions and shared trigger helpers.
--
-- pgcrypto gives us gen_random_uuid() for primary keys. Supabase projects
-- normally have it enabled already; kept explicit so this schema also
-- bootstraps cleanly on a bare Postgres instance.
create extension if not exists pgcrypto;

-- Generic "bump updated_at on every UPDATE" trigger function, reused by
-- every table below that has an updated_at column.
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger function: sets updated_at = now() on every row update. Attach via a BEFORE UPDATE trigger.';


-- =============================================================================
-- SECTION 2 — Controlled vocabularies (enums)
-- =============================================================================

-- Northbeam CRM — controlled vocabularies used across the schema.
--
-- These are modelled as native enum types (rather than text + CHECK) because
-- they are closed, stable-ish sets that drive real branching logic (state
-- machines, RLS-adjacent triggers) and benefit from compact storage and
-- index-friendly comparisons. New values can be added later with
-- `ALTER TYPE ... ADD VALUE`. Free-form/growing vocabularies (e.g. timeline
-- event kinds) are deliberately left as `text` in later sections instead.

-- Lead source — how the lead entered the CRM.
create type public.lead_source as enum (
  'linkedin',
  'email',
  'website',
  'cold_call',
  'referral',
  'event',
  'inbound_form',
  'other'
);

-- Sales pipeline stage — fine-grained forward progression of an ACTIVE lead.
-- Deliberately does not include Won/Lost/Discarded/Long-Term Nurture/DNC/
-- Merged: those are lifecycle-level outcomes (see lead_lifecycle_state)
-- and are tracked separately so a closed lead still remembers which stage
-- it was in when it closed. See leads.pipeline_stage for details.
create type public.pipeline_stage as enum (
  'new',
  'ready_for_first_call',
  'contact_attempted',
  'not_connected_nurture',
  'maybe_nurture',
  'negative_nurture',
  'meeting_scheduling',
  'meeting_scheduled',
  'meeting_follow_up',
  'proposal_preparation',
  'proposal_sent',
  'proposal_decision_pending'
);

-- Lead lifecycle — the top-level bucket a lead is in. Independent of
-- pipeline_stage, automation_mode and per-channel contactability.
create type public.lead_lifecycle_state as enum (
  'active',
  'long_term_nurture',
  'won',
  'lost',
  'discarded',
  'do_not_contact',
  'merged'
);

-- Automation mode — whether automated customer-facing communication may run
-- for this lead. Independent of pipeline_stage and lead_lifecycle_state,
-- though lifecycle changes can force this (see SECTION 18, lifecycle
-- automation triggers).
create type public.automation_mode as enum (
  'active',
  'paused',
  'manual',
  'stopped'
);

-- Conversation/response state — distinct from pipeline stage and lifecycle.
create type public.response_state as enum (
  'no_response',
  'responded',
  'conversation_active',
  'waiting_on_customer',
  'waiting_on_us'
);

-- Communication channel a contactability record applies to.
create type public.contact_channel as enum (
  'phone',
  'email',
  'whatsapp'
);

-- Call connection outcome and reason vocabularies.
create type public.call_not_connected_reason as enum (
  'no_answer',
  'busy',
  'call_rejected',
  'switched_off',
  'temporarily_unreachable',
  'voicemail',
  'network_failure',
  'invalid_number',
  'wrong_number',
  'other'
);

create type public.call_connected_outcome as enum (
  'positive',
  'maybe',
  'negative',
  'callback_requested',
  'information_requested',
  'wrong_person',
  'do_not_contact'
);

-- Tasks / next actions.
create type public.task_type as enum (
  'call',
  'follow_up',
  'send_information',
  'send_case_study',
  'send_email',
  'send_whatsapp',
  'schedule_meeting',
  'confirm_meeting',
  'reschedule',
  'prepare_proposal',
  'send_proposal',
  'proposal_follow_up',
  'nurture',
  're_engage',
  'internal_review',
  'general_task'
);

create type public.task_status as enum (
  'open',
  'completed',
  'cancelled'
);

create type public.task_origin as enum (
  'manual',
  'automation'
);

-- Meetings.
create type public.meeting_status as enum (
  'tentative',
  'scheduled',
  'confirmed',
  'rescheduled',
  'completed',
  'cancelled',
  'no_show',
  'failed'
);

create type public.meeting_outcome as enum (
  'proposal_required',
  'follow_up_required',
  'second_meeting',
  'not_interested',
  'no_proposal_required'
);

-- Proposals.
create type public.proposal_status as enum (
  'draft',
  'uploaded',
  'ready_to_send',
  'sent',
  'revision_requested',
  'revised',
  'accepted',
  'rejected',
  'withdrawn',
  'expired'
);

-- Automation: workflows, versions, runs, scheduled actions, templates.
create type public.workflow_trigger as enum (
  'call_not_connected',
  'call_outcome_maybe',
  'call_outcome_negative',
  'proposal_pending',
  'manual_enrollment'
);

create type public.workflow_status as enum (
  'active',
  'paused'
);

create type public.workflow_version_status as enum (
  'draft',
  'published',
  'previous'
);

create type public.workflow_step_action as enum (
  'send_email',
  'send_whatsapp',
  'create_call_task',
  'create_follow_up_task',
  'change_lead_stage',
  'stop_workflow'
);

create type public.workflow_run_status as enum (
  'running',
  'waiting',
  'paused',
  'completed',
  'failed',
  'cancelled'
);

create type public.scheduled_action_status as enum (
  'pending',
  'due',
  'executing',
  'completed',
  'failed',
  'cancelled',
  'paused',
  'skipped'
);

create type public.template_channel as enum (
  'email',
  'whatsapp'
);

-- Notifications.
create type public.notification_kind as enum (
  'info',
  'warning',
  'success',
  'danger'
);


-- =============================================================================
-- SECTION 3 — Salesperson profiles (Supabase Auth integration)
-- =============================================================================

-- Northbeam CRM — salesperson profiles.
--
-- One user type exists today: Salesperson. There is no roles table and no
-- role column — adding one later (for a Manager/Admin role) is a additive,
-- non-breaking change, so we don't build it speculatively now.
--
-- profiles.id is both the primary key AND the foreign key to auth.users, so
-- every CRM identity is 1:1 with a Supabase Auth identity by construction —
-- there is no parallel password/credential store in this table.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null,
  initials text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_not_blank check (length(trim(full_name)) > 0),
  constraint profiles_initials_not_blank check (length(trim(initials)) > 0)
);

comment on table public.profiles is
  'CRM salesperson profile, 1:1 with auth.users. Only user type in this phase: Salesperson.';
comment on column public.profiles.is_active is
  'Soft-disable switch for a salesperson account. Prefer this over deleting the auth.users row, '
  'so historical ownership/actor references in CRM tables stay intact. Managed via the Supabase '
  'dashboard / service role in this phase — no self-service admin UI exists yet.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- Auto-provision a CRM profile the moment a Supabase Auth identity is
-- created, so "sign up" always yields a usable salesperson record with no
-- separate manual step. SECURITY DEFINER is required because this trigger
-- runs as part of the auth.users insert, before the new user has any
-- session/RLS context of their own.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text;
  v_initials text;
begin
  v_full_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    split_part(new.email, '@', 1)
  );

  select coalesce(string_agg(left(part, 1), ''), '')
    into v_initials
    from (
      select part
      from unnest(string_to_array(v_full_name, ' ')) as part
      where length(trim(part)) > 0
      limit 2
    ) parts;

  if v_initials = '' then
    v_initials := upper(left(v_full_name, 2));
  end if;

  insert into public.profiles (id, full_name, email, initials)
  values (new.id, v_full_name, new.email, upper(v_initials));

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Provisions a public.profiles row for every new auth.users row (Supabase sign-up/invite). '
  'full_name is read from auth signup metadata (raw_user_meta_data.full_name) when provided, '
  'otherwise derived from the email local-part.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Row Level Security -------------------------------------------------------
alter table public.profiles enable row level security;

-- Any authenticated user can read the salesperson directory (needed for
-- owner pickers, "assigned to" displays, etc. across the app).
create policy profiles_select_authenticated
  on public.profiles
  for select
  to authenticated
  using (true);

-- No insert/update/delete policies for the authenticated role: profile rows
-- are created exclusively by the on_auth_user_created trigger, and edits
-- (name changes, is_active toggles) are a manual/service-role operation in
-- this phase — self-service profile editing is out of scope for this task.

-- Helper used by RLS policies on every other table: is the current caller a
-- known, active salesperson? SECURITY DEFINER so it bypasses RLS on
-- profiles itself (avoids recursive policy evaluation) and runs as a simple,
-- fast lookup.
create function public.is_active_salesperson()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and is_active
  );
$$;

comment on function public.is_active_salesperson() is
  'True if the current auth.uid() has an active CRM profile. Used as the base authorization '
  'check on all CRM business tables — deactivating a profile immediately revokes CRM access '
  'without touching auth.users or breaking historical references.';


-- =============================================================================
-- SECTION 4 — Leads (the central aggregate)
-- =============================================================================

-- Northbeam CRM — leads, the central aggregate.
create table public.leads (
  id uuid primary key default gen_random_uuid(),

  first_name text not null,
  last_name text not null default '',
  company text not null,
  job_title text,
  industry text,
  email text,
  phone text,
  source public.lead_source not null,
  service_interest text,

  owner_id uuid references public.profiles (id) on delete set null,

  -- Pipeline stage vs. lifecycle vs. automation vs. contactability are kept
  -- as four independent columns on purpose (see enums section + product
  -- brief): collapsing them into one status field is what this schema is
  -- explicitly designed to avoid.
  pipeline_stage public.pipeline_stage not null default 'new',
  lifecycle_state public.lead_lifecycle_state not null default 'active',
  automation_mode public.automation_mode not null default 'manual',
  response_state public.response_state not null default 'no_response',

  -- Do Not Contact snapshot (current state). Full suppress/reactivate
  -- history lives in dnc_events, written automatically off these columns —
  -- see SECTION 18, lifecycle automation triggers.
  dnc_reason text,
  dnc_by uuid references public.profiles (id) on delete set null,
  dnc_by_name text,
  dnc_at timestamptz,

  -- Set when lifecycle_state = 'merged'. Self-referential FK, so a lead's
  -- merge history survives even if the target lead record changes owner,
  -- stage, etc.
  merged_into_lead_id uuid references public.leads (id) on delete set null,

  last_activity_at timestamptz not null default now(),

  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint leads_first_name_not_blank check (length(trim(first_name)) > 0),
  constraint leads_company_not_blank check (length(trim(company)) > 0),
  constraint leads_has_contact_channel check (
    (email is not null and length(trim(email)) > 0)
    or (phone is not null and length(trim(phone)) > 0)
  ),
  constraint leads_merge_target_not_self check (
    merged_into_lead_id is null or merged_into_lead_id <> id
  ),
  constraint leads_merged_has_target check (
    lifecycle_state <> 'merged' or merged_into_lead_id is not null
  ),
  constraint leads_dnc_has_reason check (
    lifecycle_state <> 'do_not_contact' or dnc_reason is not null
  )
);

comment on table public.leads is
  'Central CRM lead record. pipeline_stage, lifecycle_state, automation_mode and response_state '
  'are independent axes — see column comments and the product brief for why they are not merged '
  'into a single status field.';
comment on column public.leads.pipeline_stage is
  'Forward sales-pipeline progress while the lead is lifecycle_state = active. Frozen (not '
  'reset) when the lead leaves active — this preserves "which stage was it at when it closed".';
comment on column public.leads.owner_id is
  'Nullable and ON DELETE SET NULL: a lead must never become unreachable/broken just because '
  'its owning salesperson profile is later removed. Prefer deactivating profiles (is_active) '
  'over deleting them; see profiles.is_active.';

create trigger leads_set_updated_at
  before update on public.leads
  for each row
  execute function public.set_updated_at();

-- Indexes for the access patterns the frontend already exercises: owner
-- filter dropdown, stage/lifecycle filtering, dashboard aggregates,
-- duplicate-lead lookup by email/phone, and recency sorting.
create index leads_owner_id_idx on public.leads (owner_id);
create index leads_pipeline_stage_idx on public.leads (pipeline_stage);
create index leads_lifecycle_state_idx on public.leads (lifecycle_state);
create index leads_automation_mode_idx on public.leads (automation_mode);
create index leads_created_at_idx on public.leads (created_at desc);
create index leads_email_idx on public.leads (lower(email)) where email is not null;
create index leads_phone_idx on public.leads (phone) where phone is not null;
create index leads_merged_into_idx on public.leads (merged_into_lead_id) where merged_into_lead_id is not null;

-- Row Level Security ---------------------------------------------------
-- Assumption (not determinable from the existing mock frontend, which never
-- filters the leads list by current user and lets any user assign any
-- other user as owner): this is a small, collaborative sales team, and
-- every active salesperson can see and work every lead, not just their own.
-- Revisit if per-owner visibility is later required.
alter table public.leads enable row level security;

create policy leads_select_active_salesperson
  on public.leads
  for select
  to authenticated
  using (public.is_active_salesperson());

create policy leads_insert_active_salesperson
  on public.leads
  for insert
  to authenticated
  with check (public.is_active_salesperson());

create policy leads_update_active_salesperson
  on public.leads
  for update
  to authenticated
  using (public.is_active_salesperson())
  with check (public.is_active_salesperson());

-- No delete policy: leads are never hard-deleted through the app. A lead
-- that's no longer a real opportunity is moved to lifecycle_state =
-- 'discarded' instead (covers "existing customer entered as lead" too),
-- preserving its history per the business rule that state changes must
-- never destroy records.


-- =============================================================================
-- SECTION 5 — Lead notes
-- =============================================================================

-- Northbeam CRM — free-text notes on a lead. Append-only: notes are never
-- edited or deleted once written, matching the frontend's addNote (which
-- only ever appends to Lead.notes) and the general "history must not
-- silently disappear" rule.
create table public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint lead_notes_body_not_blank check (length(trim(body)) > 0)
);

comment on table public.lead_notes is
  'Append-only notes on a lead. No update/delete policy — notes are immutable once written.';

create index lead_notes_lead_id_idx on public.lead_notes (lead_id, created_at desc);

alter table public.lead_notes enable row level security;

create policy lead_notes_select_active_salesperson
  on public.lead_notes
  for select
  to authenticated
  using (public.is_active_salesperson());

create policy lead_notes_insert_active_salesperson
  on public.lead_notes
  for insert
  to authenticated
  with check (public.is_active_salesperson());

-- No update/delete policy: notes are append-only history.


-- =============================================================================
-- SECTION 6 — Per-channel contactability
-- =============================================================================

-- Northbeam CRM — per-channel contactability state.
--
-- A bad phone number must not invalidate the whole lead: each channel
-- (phone/email/whatsapp) tracks its own state independently, in one table
-- keyed by (lead_id, channel) rather than three separate tables, since the
-- shape is identical and only the allowed status vocabulary differs per
-- channel (enforced below via a CHECK).
--
-- Absence of a row for a given channel means "not yet assessed" — rows are
-- created the first time a channel's deliverability is actually observed
-- (a bounce, an invalid-number call outcome, etc.), not eagerly on lead
-- creation.
create table public.lead_contact_channels (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  channel public.contact_channel not null,
  status text not null,
  reason text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_by_name text,

  constraint lead_contact_channels_unique_channel unique (lead_id, channel),
  constraint lead_contact_channels_valid_status check (
    (channel = 'phone' and status in
      ('valid', 'reachable', 'temporarily_unreachable', 'invalid', 'wrong_number', 'do_not_contact'))
    or (channel = 'email' and status in
      ('valid', 'delivered', 'temporary_bounce', 'permanent_bounce', 'unsubscribed', 'invalid'))
    or (channel = 'whatsapp' and status in
      ('valid', 'reachable', 'temporarily_unreachable', 'invalid', 'opted_out', 'do_not_contact'))
  )
);

comment on table public.lead_contact_channels is
  'Per-channel contactability for a lead (phone/email/whatsapp), tracked independently so one '
  'bad channel does not invalidate the others. See CHECK constraint for the allowed status '
  'vocabulary per channel.';

create index lead_contact_channels_lead_id_idx on public.lead_contact_channels (lead_id);

alter table public.lead_contact_channels enable row level security;

create policy lead_contact_channels_select_active_salesperson
  on public.lead_contact_channels
  for select
  to authenticated
  using (public.is_active_salesperson());

create policy lead_contact_channels_insert_active_salesperson
  on public.lead_contact_channels
  for insert
  to authenticated
  with check (public.is_active_salesperson());

create policy lead_contact_channels_update_active_salesperson
  on public.lead_contact_channels
  for update
  to authenticated
  using (public.is_active_salesperson())
  with check (public.is_active_salesperson());


-- =============================================================================
-- SECTION 7 — Calls
-- =============================================================================

-- Northbeam CRM — call attempt history. Calling is manual; every attempt is
-- recorded permanently and never disappears when the lead later moves to a
-- different stage.
create table public.calls (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,

  salesperson_id uuid references public.profiles (id) on delete set null,
  salesperson_name text not null,

  connected boolean not null,
  not_connected_reason public.call_not_connected_reason,
  connected_outcome public.call_connected_outcome,

  notes text,
  callback_due_at timestamptz,

  created_at timestamptz not null default now(),

  constraint calls_outcome_matches_connection check (
    (connected = false and not_connected_reason is not null and connected_outcome is null)
    or (connected = true and connected_outcome is not null and not_connected_reason is null)
  ),
  constraint calls_callback_due_requires_outcome check (
    callback_due_at is null or connected_outcome = 'callback_requested'
  )
);

comment on table public.calls is
  'Immutable log of manual call attempts. No update/delete policy — a call record must not '
  'disappear or change once logged, even as the lead progresses.';

create index calls_lead_id_idx on public.calls (lead_id, created_at desc);
create index calls_salesperson_id_idx on public.calls (salesperson_id);
create index calls_callback_due_idx on public.calls (callback_due_at) where callback_due_at is not null;

alter table public.calls enable row level security;

create policy calls_select_active_salesperson
  on public.calls
  for select
  to authenticated
  using (public.is_active_salesperson());

create policy calls_insert_active_salesperson
  on public.calls
  for insert
  to authenticated
  with check (public.is_active_salesperson());

-- No update/delete policy: call history is append-only.


-- =============================================================================
-- SECTION 8 — Tasks (next actions)
-- =============================================================================

-- Northbeam CRM — tasks. Tasks ARE the "next action" mechanism: rather than
-- duplicating a denormalized next-action snapshot on leads (which the
-- current frontend mock does and which can drift/go stale), a lead's next
-- action is derived as its earliest-due open task. See
-- lead_next_actions / active_leads_missing_next_action views in SECTION 19,
-- dashboard views.
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,

  owner_id uuid references public.profiles (id) on delete set null,
  owner_name text,

  task_type public.task_type not null,
  title text not null,
  due_at timestamptz not null,
  status public.task_status not null default 'open',
  origin public.task_origin not null default 'manual',

  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text,

  -- Populated only for automation-originated tasks, so a task's provenance
  -- (which workflow run/step created it) is always traceable.
  source_workflow_run_id uuid,
  source_workflow_step_id uuid,

  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tasks_title_not_blank check (length(trim(title)) > 0),
  constraint tasks_completed_at_matches_status check (
    (status = 'completed') = (completed_at is not null)
  ),
  constraint tasks_cancelled_at_matches_status check (
    (status = 'cancelled') = (cancelled_at is not null)
  ),
  constraint tasks_automation_origin_has_source check (
    origin <> 'automation' or source_workflow_run_id is not null
  )
);

comment on table public.tasks is
  'Manual and automation-created tasks/next-actions for a lead. Completed and cancelled tasks '
  'are kept (status column), never deleted, so they remain historically traceable.';

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row
  execute function public.set_updated_at();

-- Primary access patterns: a lead's open tasks (for next-action), a
-- salesperson's due/overdue queue, and dashboard aggregates.
create index tasks_lead_id_idx on public.tasks (lead_id);
create index tasks_open_due_idx on public.tasks (due_at) where status = 'open';
create index tasks_owner_open_due_idx on public.tasks (owner_id, due_at) where status = 'open';

alter table public.tasks enable row level security;

create policy tasks_select_active_salesperson
  on public.tasks
  for select
  to authenticated
  using (public.is_active_salesperson());

create policy tasks_insert_active_salesperson
  on public.tasks
  for insert
  to authenticated
  with check (public.is_active_salesperson());

create policy tasks_update_active_salesperson
  on public.tasks
  for update
  to authenticated
  using (public.is_active_salesperson())
  with check (public.is_active_salesperson());

-- No delete policy: completing/cancelling a task is a status change, not a
-- deletion — see tasks.status.


-- =============================================================================
-- SECTION 9 — Meetings
-- =============================================================================

-- Northbeam CRM — meetings.
create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,

  owner_id uuid references public.profiles (id) on delete set null,
  owner_name text,

  title text not null,
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 30,
  meeting_url text,

  status public.meeting_status not null default 'tentative',
  outcome public.meeting_outcome,
  notes text,

  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint meetings_title_not_blank check (length(trim(title)) > 0),
  constraint meetings_duration_positive check (duration_minutes > 0),
  constraint meetings_outcome_requires_completed check (
    outcome is null or status = 'completed'
  )
);

comment on table public.meetings is
  'Meetings scheduled against a lead. Outcome is only meaningful once a meeting is completed.';

create trigger meetings_set_updated_at
  before update on public.meetings
  for each row
  execute function public.set_updated_at();

create index meetings_lead_id_idx on public.meetings (lead_id, scheduled_at desc);
create index meetings_owner_scheduled_idx on public.meetings (owner_id, scheduled_at);

alter table public.meetings enable row level security;

create policy meetings_select_active_salesperson
  on public.meetings
  for select
  to authenticated
  using (public.is_active_salesperson());

create policy meetings_insert_active_salesperson
  on public.meetings
  for insert
  to authenticated
  with check (public.is_active_salesperson());

create policy meetings_update_active_salesperson
  on public.meetings
  for update
  to authenticated
  using (public.is_active_salesperson())
  with check (public.is_active_salesperson());

-- No delete policy: a cancelled/no-show meeting is a status change, not a
-- deletion.


-- =============================================================================
-- SECTION 10 — Proposals
-- =============================================================================

-- Northbeam CRM — proposals. Prepared manually and managed/uploaded through
-- the CRM. Actual file storage (Supabase Storage) integration is a backend
-- concern for a later phase; document_reference is a plain text pointer
-- (file name / storage path / external URL) for now, mirroring the
-- frontend mock's fileName field.
create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,

  owner_id uuid references public.profiles (id) on delete set null,
  owner_name text,

  title text not null,
  document_reference text,
  amount numeric(14, 2),
  currency text not null default 'INR',

  status public.proposal_status not null default 'draft',
  sent_at timestamptz,
  follow_up_at timestamptz,
  next_action text,
  notes text,

  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint proposals_title_not_blank check (length(trim(title)) > 0),
  constraint proposals_amount_non_negative check (amount is null or amount >= 0),
  constraint proposals_sent_at_requires_sent_status check (
    sent_at is null or status in ('sent', 'revision_requested', 'revised', 'accepted', 'rejected', 'withdrawn', 'expired')
  )
);

comment on table public.proposals is
  'Proposals prepared and tracked manually. accepted -> the lifecycle automation trigger moves '
  'the parent lead to Won and stops its automation (see SECTION 18, lifecycle automation triggers).';

create trigger proposals_set_updated_at
  before update on public.proposals
  for each row
  execute function public.set_updated_at();

create index proposals_lead_id_idx on public.proposals (lead_id, updated_at desc);
create index proposals_owner_status_idx on public.proposals (owner_id, status);
create index proposals_follow_up_idx on public.proposals (follow_up_at) where follow_up_at is not null;

alter table public.proposals enable row level security;

create policy proposals_select_active_salesperson
  on public.proposals
  for select
  to authenticated
  using (public.is_active_salesperson());

create policy proposals_insert_active_salesperson
  on public.proposals
  for insert
  to authenticated
  with check (public.is_active_salesperson());

create policy proposals_update_active_salesperson
  on public.proposals
  for update
  to authenticated
  using (public.is_active_salesperson())
  with check (public.is_active_salesperson());

-- No delete policy: proposal history must remain trustworthy.


-- =============================================================================
-- SECTION 11 — Message templates
-- =============================================================================

-- Northbeam CRM — reusable email/WhatsApp message templates used by
-- workflow steps. Kept simple and independent of n8n for this MVP.
create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel public.template_channel not null,
  subject text,
  body text not null,
  attachment_reference text,
  is_active boolean not null default true,

  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint message_templates_name_not_blank check (length(trim(name)) > 0),
  constraint message_templates_body_not_blank check (length(trim(body)) > 0),
  constraint message_templates_whatsapp_no_subject check (
    channel <> 'whatsapp' or subject is null
  )
);

comment on table public.message_templates is
  'Reusable Email/WhatsApp templates referenced by workflow steps. Provider integration '
  '(actually sending) is out of scope for this phase.';

create trigger message_templates_set_updated_at
  before update on public.message_templates
  for each row
  execute function public.set_updated_at();

create index message_templates_channel_active_idx on public.message_templates (channel, is_active);

alter table public.message_templates enable row level security;

create policy message_templates_select_active_salesperson
  on public.message_templates
  for select
  to authenticated
  using (public.is_active_salesperson());

create policy message_templates_insert_active_salesperson
  on public.message_templates
  for insert
  to authenticated
  with check (public.is_active_salesperson());

create policy message_templates_update_active_salesperson
  on public.message_templates
  for update
  to authenticated
  using (public.is_active_salesperson())
  with check (public.is_active_salesperson());

-- No delete policy: a template already referenced by a published workflow
-- step must not disappear from under that step's history. Deactivate via
-- is_active instead.


-- =============================================================================
-- SECTION 12 — Workflows, versions and steps
-- =============================================================================

-- Northbeam CRM — automation workflows, their versions and steps.
--
-- A workflow's "current published version" and "current draft" are not
-- stored as denormalized pointer columns on workflows (which would need to
-- stay in sync and could go stale); they're derived from workflow_versions
-- via the partial unique indexes below, which also enforce the business
-- rule "only one Published and only one Draft version per workflow at a
-- time" at the database level.
create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  trigger public.workflow_trigger not null,
  status public.workflow_status not null default 'paused',

  owner_id uuid references public.profiles (id) on delete set null,

  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint workflows_name_not_blank check (length(trim(name)) > 0)
);

comment on table public.workflows is
  'An automation workflow (e.g. Not Connected Nurture). Its editable content lives in '
  'workflow_versions/workflow_steps, never directly on this row.';

create trigger workflows_set_updated_at
  before update on public.workflows
  for each row
  execute function public.set_updated_at();

create index workflows_trigger_status_idx on public.workflows (trigger, status);

create table public.workflow_versions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  version_number integer not null,
  status public.workflow_version_status not null default 'draft',

  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  published_at timestamptz,

  constraint workflow_versions_number_positive check (version_number > 0),
  constraint workflow_versions_unique_number unique (workflow_id, version_number),
  constraint workflow_versions_published_at_matches_status check (
    (status = 'draft' and published_at is null)
    or (status in ('published', 'previous') and published_at is not null)
  )
);

comment on table public.workflow_versions is
  'Immutable-once-published snapshot of a workflow''s steps (enforced by the '
  'workflow_steps_draft_only_edit trigger). Existing workflow_runs keep referencing the exact '
  'version they were enrolled against even after a newer version is published.';

-- Enforce "only one Draft" and "only one Published" version per workflow at
-- a time — this is exactly what publishVersion()/createDraft() in the
-- current frontend mock already assume.
create unique index workflow_versions_one_draft_per_workflow
  on public.workflow_versions (workflow_id)
  where status = 'draft';

create unique index workflow_versions_one_published_per_workflow
  on public.workflow_versions (workflow_id)
  where status = 'published';

create index workflow_versions_workflow_id_idx on public.workflow_versions (workflow_id);

create table public.workflow_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_version_id uuid not null references public.workflow_versions (id) on delete cascade,
  step_order integer not null,
  delay_days integer not null default 0,
  action public.workflow_step_action not null,
  template_id uuid references public.message_templates (id) on delete set null,
  -- Task title / target pipeline stage / free-text config, meaning depends
  -- on `action` — mirrors the frontend's WorkflowStep.config field.
  config text,
  is_enabled boolean not null default true,

  constraint workflow_steps_order_non_negative check (step_order >= 0),
  constraint workflow_steps_delay_non_negative check (delay_days >= 0),
  constraint workflow_steps_unique_order unique (workflow_version_id, step_order),
  -- A template only makes sense on a message-sending step. (Deliberately
  -- one-directional: a Send Email/WhatsApp step is allowed a transient
  -- null template_id while being edited in the builder before a template
  -- is picked.)
  constraint workflow_steps_template_only_on_message_action check (
    template_id is null or action in ('send_email', 'send_whatsapp')
  )
);

comment on table public.workflow_steps is
  'Ordered steps within one workflow_version. Only editable while the parent version is Draft — '
  'see workflow_steps_draft_only_edit trigger.';

create index workflow_steps_version_id_idx on public.workflow_steps (workflow_version_id, step_order);

-- Defense-in-depth for "only a Draft version is editable": reject any
-- insert/update/delete on steps whose parent version is not Draft, so a
-- Published/Previous version's historical meaning can never be silently
-- mutated even if application code has a bug.
create function public.enforce_workflow_steps_draft_only()
returns trigger
language plpgsql
as $$
declare
  v_version_id uuid;
  v_status public.workflow_version_status;
begin
  v_version_id := coalesce(new.workflow_version_id, old.workflow_version_id);

  select status into v_status
  from public.workflow_versions
  where id = v_version_id;

  if v_status is distinct from 'draft' then
    raise exception 'workflow_steps can only be modified while their workflow_version is Draft (version status: %)', v_status
      using errcode = '23514';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger workflow_steps_draft_only_edit
  before insert or update or delete on public.workflow_steps
  for each row
  execute function public.enforce_workflow_steps_draft_only();

-- Row Level Security ---------------------------------------------------
alter table public.workflows enable row level security;
alter table public.workflow_versions enable row level security;
alter table public.workflow_steps enable row level security;

create policy workflows_select_active_salesperson
  on public.workflows for select to authenticated
  using (public.is_active_salesperson());
create policy workflows_insert_active_salesperson
  on public.workflows for insert to authenticated
  with check (public.is_active_salesperson());
create policy workflows_update_active_salesperson
  on public.workflows for update to authenticated
  using (public.is_active_salesperson()) with check (public.is_active_salesperson());

create policy workflow_versions_select_active_salesperson
  on public.workflow_versions for select to authenticated
  using (public.is_active_salesperson());
create policy workflow_versions_insert_active_salesperson
  on public.workflow_versions for insert to authenticated
  with check (public.is_active_salesperson());
create policy workflow_versions_update_active_salesperson
  on public.workflow_versions for update to authenticated
  using (public.is_active_salesperson()) with check (public.is_active_salesperson());

create policy workflow_steps_select_active_salesperson
  on public.workflow_steps for select to authenticated
  using (public.is_active_salesperson());
create policy workflow_steps_insert_active_salesperson
  on public.workflow_steps for insert to authenticated
  with check (public.is_active_salesperson());
create policy workflow_steps_update_active_salesperson
  on public.workflow_steps for update to authenticated
  using (public.is_active_salesperson()) with check (public.is_active_salesperson());
create policy workflow_steps_delete_active_salesperson
  on public.workflow_steps for delete to authenticated
  using (public.is_active_salesperson());

-- workflow_steps is the one table in this migration with a delete policy:
-- removing a draft step (builder's "Remove step") is a real, supported
-- action, and the trigger above guarantees it can only happen pre-publish.


-- =============================================================================
-- SECTION 13 — Workflow runs
-- =============================================================================

-- Northbeam CRM — workflow runs: a lead's enrollment/execution against one
-- exact workflow_version. workflow_version_id is intentionally ON DELETE
-- RESTRICT (via the NOT NULL FK below) so a run can never end up pointing
-- at nothing — it must always be able to answer "which exact version was I
-- enrolled against", even after newer versions are published (rule: a run
-- keeps the version it started with; new enrollments use the newest
-- published version, decided by the caller at enrollment time, not by the
-- schema).
create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),

  workflow_id uuid not null references public.workflows (id) on delete restrict,
  workflow_version_id uuid not null references public.workflow_versions (id) on delete restrict,
  lead_id uuid not null references public.leads (id) on delete cascade,

  current_step_id uuid references public.workflow_steps (id) on delete set null,
  status public.workflow_run_status not null default 'running',

  started_at timestamptz not null default now(),
  next_run_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  last_error text,

  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint workflow_runs_completed_at_matches_status check (
    (status = 'completed') = (completed_at is not null)
  ),
  constraint workflow_runs_cancelled_at_matches_status check (
    (status = 'cancelled') = (cancelled_at is not null)
  )
);

comment on table public.workflow_runs is
  'A lead''s enrollment in one workflow_version. Preserved forever (no delete policy) — '
  'automation history must remain inspectable even after the run finishes/is cancelled.';

create trigger workflow_runs_set_updated_at
  before update on public.workflow_runs
  for each row
  execute function public.set_updated_at();

create index workflow_runs_lead_id_idx on public.workflow_runs (lead_id);
create index workflow_runs_workflow_id_idx on public.workflow_runs (workflow_id);
create index workflow_runs_status_next_run_idx on public.workflow_runs (status, next_run_at)
  where status in ('running', 'waiting');

-- Now that workflow_runs/workflow_steps exist, wire up the provenance FKs
-- on tasks that were declared (without a foreign key) in SECTION 8.
alter table public.tasks
  add constraint tasks_source_workflow_run_fk
    foreign key (source_workflow_run_id) references public.workflow_runs (id) on delete set null,
  add constraint tasks_source_workflow_step_fk
    foreign key (source_workflow_step_id) references public.workflow_steps (id) on delete set null;

create index tasks_source_workflow_run_idx on public.tasks (source_workflow_run_id)
  where source_workflow_run_id is not null;

alter table public.workflow_runs enable row level security;

create policy workflow_runs_select_active_salesperson
  on public.workflow_runs for select to authenticated
  using (public.is_active_salesperson());
create policy workflow_runs_insert_active_salesperson
  on public.workflow_runs for insert to authenticated
  with check (public.is_active_salesperson());
create policy workflow_runs_update_active_salesperson
  on public.workflow_runs for update to authenticated
  using (public.is_active_salesperson()) with check (public.is_active_salesperson());

-- No delete policy: runs are cancelled (status = 'cancelled'), never removed.


-- =============================================================================
-- SECTION 14 — Scheduled automation actions
-- =============================================================================

-- Northbeam CRM — scheduled automation actions.
--
-- This table is the source of truth for future automation work, per the
-- explicit product rule: n8n must never be the source of truth for
-- scheduled CRM automation. A future execution worker (n8n or otherwise)
-- polls/claims rows here; it does not independently decide what/when to
-- run.
--
-- Each row is created by exactly one workflow_step within one
-- workflow_run — manual tasks (not automation) live in `tasks`, not here.
create table public.scheduled_actions (
  id uuid primary key default gen_random_uuid(),

  lead_id uuid not null references public.leads (id) on delete cascade,
  workflow_run_id uuid not null references public.workflow_runs (id) on delete cascade,
  workflow_step_id uuid not null references public.workflow_steps (id) on delete restrict,

  action_type public.workflow_step_action not null,
  scheduled_for timestamptz not null,
  status public.scheduled_action_status not null default 'pending',

  -- Snapshot of the inputs needed to execute (template id, target stage,
  -- task title, etc.) taken at scheduling time, so a later edit to the
  -- source template/step cannot silently change what an already-scheduled
  -- action will do.
  payload jsonb not null default '{}'::jsonb,

  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  last_attempt_at timestamptz,
  last_error text,

  executed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One scheduled action per (run, step): a given workflow step executes at
  -- most once per run, which also rules out accidental duplicate
  -- scheduling.
  constraint scheduled_actions_unique_run_step unique (workflow_run_id, workflow_step_id),
  constraint scheduled_actions_attempt_count_non_negative check (attempt_count >= 0),
  constraint scheduled_actions_max_attempts_positive check (max_attempts > 0),
  constraint scheduled_actions_executed_at_matches_status check (
    (status = 'completed') = (executed_at is not null)
  ),
  constraint scheduled_actions_cancelled_at_matches_status check (
    (status = 'cancelled') = (cancelled_at is not null)
  )
);

comment on table public.scheduled_actions is
  'Source of truth for future automation execution (send email, create task, change stage, '
  'stop workflow, ...). A worker claims pending/due rows, re-checks lead eligibility '
  'immediately before executing (lifecycle_state, automation_mode, DNC, contactability — '
  'not enforced here, since that check must happen at execution time, not schedule time), '
  'and moves status forward. The (workflow_run_id, workflow_step_id) uniqueness constraint '
  'prevents duplicate scheduling; status stays authoritative for retry/pause/cancel decisions.';

create trigger scheduled_actions_set_updated_at
  before update on public.scheduled_actions
  for each row
  execute function public.set_updated_at();

create index scheduled_actions_due_idx on public.scheduled_actions (scheduled_for)
  where status in ('pending', 'due');
create index scheduled_actions_lead_id_idx on public.scheduled_actions (lead_id);
create index scheduled_actions_workflow_run_id_idx on public.scheduled_actions (workflow_run_id);

alter table public.scheduled_actions enable row level security;

create policy scheduled_actions_select_active_salesperson
  on public.scheduled_actions for select to authenticated
  using (public.is_active_salesperson());
create policy scheduled_actions_insert_active_salesperson
  on public.scheduled_actions for insert to authenticated
  with check (public.is_active_salesperson());
create policy scheduled_actions_update_active_salesperson
  on public.scheduled_actions for update to authenticated
  using (public.is_active_salesperson()) with check (public.is_active_salesperson());

-- No delete policy: cancel via status, don't remove — this is the audit
-- trail for what automation was ever going to do.


-- =============================================================================
-- SECTION 15 — Timeline / activity audit log
-- =============================================================================

-- Northbeam CRM — the cross-domain activity/audit timeline shown on the
-- Lead Detail screen. Every other domain (calls, tasks, meetings,
-- proposals, workflows, lifecycle changes) appends here; nothing updates or
-- deletes an existing entry.
--
-- event_kind is deliberately `text`, not an enum: the product brief lists
-- 30+ event kinds already and more will be added as the product grows.
-- Unlike pipeline_stage/lifecycle_state/etc. (closed sets that drive real
-- state-machine branching), this is descriptive audit metadata, so a
-- CHECK-free text column is the right amount of structure — a growing enum
-- would need a migration for every new event kind without adding any real
-- integrity guarantee.
create table public.timeline_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,

  occurred_at timestamptz not null default now(),
  event_kind text not null,
  title text not null,
  detail text,

  actor_id uuid references public.profiles (id) on delete set null,
  -- Always populated, even when actor_id is null (automation/system
  -- events, or a since-removed profile) — this is what keeps the timeline
  -- readable independent of whether the acting profile still exists.
  actor_name text not null,
  actor_source text not null,

  related_task_id uuid references public.tasks (id) on delete set null,
  related_meeting_id uuid references public.meetings (id) on delete set null,
  related_proposal_id uuid references public.proposals (id) on delete set null,
  related_call_id uuid references public.calls (id) on delete set null,
  related_workflow_run_id uuid references public.workflow_runs (id) on delete set null,

  metadata jsonb,

  created_at timestamptz not null default now(),

  constraint timeline_events_kind_not_blank check (length(trim(event_kind)) > 0),
  constraint timeline_events_title_not_blank check (length(trim(title)) > 0),
  constraint timeline_events_actor_source_valid check (
    actor_source in ('manual', 'automation', 'system')
  )
);

comment on table public.timeline_events is
  'Append-only per-lead activity/audit log. No update/delete policy — changing current state '
  'must never rewrite what the timeline already recorded happened.';

create index timeline_events_lead_id_idx on public.timeline_events (lead_id, occurred_at desc);
create index timeline_events_actor_id_idx on public.timeline_events (actor_id) where actor_id is not null;

alter table public.timeline_events enable row level security;

create policy timeline_events_select_active_salesperson
  on public.timeline_events for select to authenticated
  using (public.is_active_salesperson());
create policy timeline_events_insert_active_salesperson
  on public.timeline_events for insert to authenticated
  with check (public.is_active_salesperson());

-- No update/delete policy: the timeline is immutable, append-only history.


-- =============================================================================
-- SECTION 16 — Do Not Contact suppression history
-- =============================================================================

-- Northbeam CRM — Do Not Contact suppression history.
--
-- leads.lifecycle_state / dnc_reason / dnc_by / dnc_at hold the CURRENT DNC
-- snapshot; this table holds the full, append-only suppress/reactivate
-- history, independent of whatever the current lifecycle_state happens to
-- be. It exists specifically so that "removing DNC later must never happen
-- casually or accidentally" and "suppression history must remain
-- trustworthy" hold even across a reactivation — reactivating a lead does
-- not erase the fact that it was once suppressed.
--
-- Rows are inserted automatically by the lifecycle automation trigger
-- (see SECTION 18, lifecycle automation triggers) whenever
-- leads.lifecycle_state transitions into/out of 'do_not_contact' — this
-- table is not meant to be written to directly by application code.
create table public.dnc_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  action text not null,
  reason text,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  created_at timestamptz not null default now(),

  constraint dnc_events_action_valid check (action in ('suppressed', 'reactivated'))
);

comment on table public.dnc_events is
  'Append-only Do Not Contact suppress/reactivate history, written automatically by a trigger '
  'on leads. Never updated or deleted, and never written to directly.';

create index dnc_events_lead_id_idx on public.dnc_events (lead_id, created_at desc);

alter table public.dnc_events enable row level security;

create policy dnc_events_select_active_salesperson
  on public.dnc_events for select to authenticated
  using (public.is_active_salesperson());

-- No insert/update/delete policy for the authenticated role: rows are
-- written only by the SECURITY DEFINER trigger in SECTION 18, which runs
-- with elevated privilege and bypasses RLS.


-- =============================================================================
-- SECTION 17 — Notifications
-- =============================================================================

-- Northbeam CRM — per-salesperson notifications (the app shell's bell
-- popover).
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,

  title text not null,
  detail text,
  kind public.notification_kind not null default 'info',
  lead_id uuid references public.leads (id) on delete cascade,
  href text,
  read boolean not null default false,

  created_at timestamptz not null default now(),

  constraint notifications_title_not_blank check (length(trim(title)) > 0)
);

comment on table public.notifications is
  'Per-recipient notifications. A salesperson can only see and mark-read their own.';

create index notifications_recipient_unread_idx on public.notifications (recipient_id, read, created_at desc);

alter table public.notifications enable row level security;

create policy notifications_select_own
  on public.notifications
  for select
  to authenticated
  using (recipient_id = auth.uid() and public.is_active_salesperson());

-- Any active salesperson may create a notification for any recipient (e.g.
-- to flag a teammate about a lead) — small collaborative team, same
-- shared-visibility assumption as the rest of the schema.
create policy notifications_insert_active_salesperson
  on public.notifications
  for insert
  to authenticated
  with check (public.is_active_salesperson());

-- A recipient may update only their own notifications (marking read).
create policy notifications_update_own
  on public.notifications
  for update
  to authenticated
  using (recipient_id = auth.uid() and public.is_active_salesperson())
  with check (recipient_id = auth.uid());


-- =============================================================================
-- SECTION 18 — Lifecycle / automation integrity triggers (cross-cutting)
-- =============================================================================

-- Northbeam CRM — cross-cutting lifecycle/automation enforcement.
--
-- These triggers implement the product rules that must hold regardless of
-- which future client (this app's eventual backend, an admin script, a
-- one-off SQL fix) touches a lead row:
--   - Automation must not continue normally for Won/Lost/Discarded/DNC/
--     Merged leads.
--   - Automation that becomes irrelevant because the lead changed state
--     must be cancellable/invalidated, not left to fire later.
--   - DNC overrides normal nurture/automation immediately, and DNC
--     suppression history must remain trustworthy across a reactivation.
--
-- Deliberately NOT implemented here (left for the future backend): call
-- outcome -> stage/task routing, meeting outcome routing, proposal status
-- routing, workflow enrollment, or resuming a paused automation. Those are
-- product/orchestration logic, not structural data-integrity rules, and
-- belong in the backend phase.

create function public.enforce_lead_terminal_automation()
returns trigger
language plpgsql
as $$
begin
  if new.lifecycle_state in ('won', 'lost', 'discarded', 'do_not_contact', 'merged') then
    new.automation_mode := 'stopped';
  end if;
  return new;
end;
$$;

comment on function public.enforce_lead_terminal_automation() is
  'Forces automation_mode = stopped whenever a lead is in a terminal lifecycle state, so no '
  'write path can leave a Won/Lost/Discarded/DNC/Merged lead with automation still enabled.';

create trigger leads_enforce_terminal_automation
  before insert or update on public.leads
  for each row
  execute function public.enforce_lead_terminal_automation();

create function public.cascade_lead_lifecycle_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_lifecycle public.lead_lifecycle_state;
  v_reason text;
begin
  if tg_op = 'INSERT' then
    v_old_lifecycle := null;
  else
    v_old_lifecycle := old.lifecycle_state;
  end if;

  -- Entering a terminal state: invalidate whatever automation was still
  -- pending for this lead instead of letting it fire later.
  if new.lifecycle_state in ('won', 'lost', 'discarded', 'do_not_contact', 'merged')
     and v_old_lifecycle is distinct from new.lifecycle_state then
    v_reason := 'Lead lifecycle changed to ' || new.lifecycle_state;

    update public.workflow_runs
    set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason
    where lead_id = new.id
      and status in ('running', 'waiting', 'paused');

    update public.scheduled_actions
    set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason
    where lead_id = new.id
      and status in ('pending', 'due', 'paused');
  end if;

  -- Entering Do Not Contact: record the suppression permanently.
  if new.lifecycle_state = 'do_not_contact'
     and v_old_lifecycle is distinct from 'do_not_contact' then
    insert into public.dnc_events (lead_id, action, reason, actor_id, actor_name)
    values (new.id, 'suppressed', new.dnc_reason, new.dnc_by, new.dnc_by_name);
  end if;

  -- Leaving Do Not Contact: this must be an explicit, reasoned action, not
  -- an incidental side effect of some other bulk update — require a reason
  -- to be present on the row being written, and record the reactivation
  -- permanently. dnc_events already preserves the original suppression
  -- record from above, so reactivating never erases that history.
  if v_old_lifecycle = 'do_not_contact' and new.lifecycle_state <> 'do_not_contact' then
    if new.dnc_reason is null then
      raise exception 'Reactivating a Do Not Contact lead requires dnc_reason to explain why.'
        using errcode = '23514';
    end if;

    insert into public.dnc_events (lead_id, action, reason, actor_id, actor_name)
    values (new.id, 'reactivated', new.dnc_reason, new.dnc_by, new.dnc_by_name);
  end if;

  return new;
end;
$$;

comment on function public.cascade_lead_lifecycle_change() is
  'On any lead lifecycle_state change: cancels in-flight workflow_runs/scheduled_actions when '
  'entering a terminal state, and writes an immutable dnc_events row on every DNC '
  'suppress/reactivate transition. SECURITY DEFINER because authenticated users have no direct '
  'insert policy on dnc_events (see SECTION 16) — writes only ever happen through this trigger.';

create trigger leads_cascade_lifecycle_change
  after insert or update on public.leads
  for each row
  execute function public.cascade_lead_lifecycle_change();


-- =============================================================================
-- SECTION 19 — Dashboard convenience views
-- =============================================================================

-- Northbeam CRM — read-only convenience views for the "every active lead
-- needs a next action" rule and the dashboard aggregates already present in
-- the frontend mock. Plain views (not SECURITY DEFINER / not materialized):
-- they run with the querying user's own permissions, so the RLS policies on
-- leads/tasks already defined above apply exactly as they would to a direct
-- query.

-- A lead's current next action = its earliest-due open task. One row per
-- lead that has at least one open task.
create view public.lead_next_actions as
select distinct on (t.lead_id)
  t.lead_id,
  t.id as task_id,
  t.task_type,
  t.title,
  t.due_at,
  t.owner_id,
  t.owner_name,
  t.origin
from public.tasks t
where t.status = 'open'
order by t.lead_id, t.due_at asc;

comment on view public.lead_next_actions is
  'Earliest open task per lead — the lead''s current next action. Absence of a row for a lead '
  'means it has no open task at all.';

-- Active/pursuable leads with no open task at all — the direct query for
-- rule #1 ("every active lead should have a meaningful next action").
create view public.active_leads_missing_next_action as
select l.*
from public.leads l
where l.lifecycle_state = 'active'
  and not exists (
    select 1 from public.tasks t
    where t.lead_id = l.id
      and t.status = 'open'
  );

comment on view public.active_leads_missing_next_action is
  'Active leads with zero open tasks — leads currently violating the "every active lead needs '
  'a next action" rule.';

-- Open tasks that are overdue or due today, for the salesperson-facing
-- queue and dashboard counts.
create view public.overdue_tasks as
select *
from public.tasks
where status = 'open'
  and due_at < now();

create view public.tasks_due_today as
select *
from public.tasks
where status = 'open'
  and due_at >= date_trunc('day', now())
  and due_at < date_trunc('day', now()) + interval '1 day';

comment on view public.overdue_tasks is 'Open tasks whose due_at has already passed.';
comment on view public.tasks_due_today is 'Open tasks due within the current calendar day (server time).';

-- =============================================================================
-- End of 001_initial_migration
-- =============================================================================
