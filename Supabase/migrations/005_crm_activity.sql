-- 005_crm_activity.sql
-- notes, calls, tasks, meetings + participants, proposals, timeline_events, notifications.
-- FKs to workflow_runs/workflow_steps/message_templates are added in 006.
--
-- Delete rules: deleting a contact removes everything about it. Deleting a deal removes what
-- the deal owns (tasks, meetings, proposals); notes/calls/timeline stay on the contact.

begin;

create table crm.notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces (id) on delete cascade,
  contact_id uuid not null,
  deal_id uuid,
  author_id uuid references crm.profiles (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint notes_contact_fk foreign key (contact_id, workspace_id)
    references crm.contacts (id, workspace_id) on delete cascade,
  constraint notes_deal_fk foreign key (deal_id, workspace_id)
    references crm.deals (id, workspace_id) on delete set null (deal_id),
  constraint notes_body_not_blank check (length(trim(body)) > 0)
);

create index notes_contact_id_idx on crm.notes (contact_id, created_at desc);
create index notes_deal_id_idx on crm.notes (deal_id) where deal_id is not null;

create table crm.calls (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces (id) on delete cascade,
  contact_id uuid not null,
  deal_id uuid,
  salesperson_id uuid references crm.profiles (id) on delete set null,
  connected boolean not null,
  not_connected_reason crm.call_not_connected_reason,
  connected_outcome crm.call_connected_outcome,
  notes text,
  callback_due_at timestamptz,
  external_source text,
  external_id text,
  created_at timestamptz not null default now(),
  constraint calls_id_workspace_key unique (id, workspace_id),
  constraint calls_contact_fk foreign key (contact_id, workspace_id)
    references crm.contacts (id, workspace_id) on delete cascade,
  constraint calls_deal_fk foreign key (deal_id, workspace_id)
    references crm.deals (id, workspace_id) on delete set null (deal_id),
  constraint calls_outcome_matches_connection check (
    (connected = false and not_connected_reason is not null and connected_outcome is null)
    or (connected = true and connected_outcome is not null and not_connected_reason is null)
  ),
  constraint calls_callback_due_requires_outcome check (
    callback_due_at is null or connected_outcome = 'callback_requested'
  ),
  constraint calls_external_pair check ((external_source is null) = (external_id is null))
);

create index calls_contact_id_idx on crm.calls (contact_id, created_at desc);
create index calls_deal_id_idx on crm.calls (deal_id) where deal_id is not null;
create index calls_salesperson_id_idx on crm.calls (salesperson_id);
create index calls_callback_due_idx on crm.calls (callback_due_at) where callback_due_at is not null;
create unique index calls_workspace_external_key on crm.calls (workspace_id, external_source, external_id)
  where external_id is not null;

create table crm.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces (id) on delete cascade,
  deal_id uuid,
  contact_id uuid,
  owner_id uuid references crm.profiles (id) on delete set null,
  task_type crm.task_type not null,
  title text not null,
  due_at timestamptz not null,
  status crm.task_status not null default 'open',
  origin crm.task_origin not null default 'manual',
  -- FKs added in 006.
  source_workflow_run_id uuid,
  source_workflow_step_id uuid,
  created_by uuid references crm.profiles (id) on delete set null,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_id_workspace_key unique (id, workspace_id),
  constraint tasks_deal_fk foreign key (deal_id, workspace_id)
    references crm.deals (id, workspace_id) on delete cascade,
  constraint tasks_contact_fk foreign key (contact_id, workspace_id)
    references crm.contacts (id, workspace_id) on delete cascade,
  constraint tasks_has_deal_or_contact check (deal_id is not null or contact_id is not null),
  constraint tasks_title_not_blank check (length(trim(title)) > 0),
  constraint tasks_completed_at_matches_status check ((status = 'completed') = (completed_at is not null)),
  constraint tasks_cancelled_at_matches_status check ((status = 'cancelled') = (cancelled_at is not null))
);

create index tasks_deal_id_idx on crm.tasks (deal_id) where deal_id is not null;
create index tasks_contact_id_idx on crm.tasks (contact_id) where contact_id is not null;
create index tasks_workspace_open_due_idx on crm.tasks (workspace_id, due_at) where status = 'open';
create index tasks_owner_open_due_idx on crm.tasks (owner_id, due_at) where status = 'open';

create table crm.meetings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces (id) on delete cascade,
  deal_id uuid not null,
  owner_id uuid references crm.profiles (id) on delete set null,
  title text not null,
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 30,
  meeting_url text,
  status crm.meeting_status not null default 'tentative',
  outcome crm.meeting_outcome,
  notes text,

  calendar_event_id text,
  meet_link text,
  calendar_sync_status text not null default 'not_applicable',
  calendar_sync_error text,

  notify_email_status text not null default 'not_applicable',
  notify_email_sent_at timestamptz,
  notify_email_error text,
  notify_whatsapp_status text not null default 'not_applicable',
  notify_whatsapp_sent_at timestamptz,
  notify_whatsapp_error text,
  notify_whatsapp_next_attempt_at timestamptz,
  notify_whatsapp_attempt_count integer not null default 0,

  created_by uuid references crm.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meetings_id_workspace_key unique (id, workspace_id),
  constraint meetings_deal_fk foreign key (deal_id, workspace_id)
    references crm.deals (id, workspace_id) on delete cascade,
  constraint meetings_title_not_blank check (length(trim(title)) > 0),
  constraint meetings_duration_positive check (duration_minutes > 0),
  constraint meetings_outcome_requires_completed check (outcome is null or status = 'completed'),
  constraint meetings_calendar_sync_status_valid check (
    calendar_sync_status in ('not_applicable', 'pending', 'synced', 'failed')
  ),
  constraint meetings_notify_email_status_valid check (
    notify_email_status in ('not_applicable', 'pending', 'skipped', 'sent', 'failed')
  ),
  constraint meetings_notify_whatsapp_status_valid check (
    notify_whatsapp_status in ('not_applicable', 'skipped', 'queued', 'sending', 'sent', 'failed')
  )
);

create index meetings_deal_id_idx on crm.meetings (deal_id, scheduled_at desc);
create index meetings_workspace_scheduled_idx on crm.meetings (workspace_id, scheduled_at);
create index meetings_owner_scheduled_idx on crm.meetings (owner_id, scheduled_at);
create index meetings_notify_whatsapp_queue_idx on crm.meetings (notify_whatsapp_next_attempt_at)
  where notify_whatsapp_status = 'queued';

create table crm.meeting_participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references crm.meetings (id) on delete cascade,
  name text,
  email text not null,
  created_at timestamptz not null default now(),
  constraint meeting_participants_email_valid check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create index meeting_participants_meeting_id_idx on crm.meeting_participants (meeting_id);

create table crm.proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces (id) on delete cascade,
  deal_id uuid not null,
  owner_id uuid references crm.profiles (id) on delete set null,
  title text not null,
  amount numeric(14, 2),
  currency text not null default 'INR',
  status crm.proposal_status not null default 'draft',
  sent_at timestamptz,
  follow_up_at timestamptz,
  next_action text,
  notes text,

  -- File lives in the private bucket crm-proposal-documents.
  document_storage_path text,
  document_file_name text,
  document_mime_type text,
  document_size_bytes integer,

  -- FKs to crm.message_templates added in 006.
  email_template_id uuid,
  whatsapp_template_id uuid,
  email_send_status text not null default 'not_applicable',
  email_sent_at timestamptz,
  email_send_error text,
  whatsapp_send_status text not null default 'not_applicable',
  whatsapp_sent_at timestamptz,
  whatsapp_send_error text,
  whatsapp_next_attempt_at timestamptz,
  whatsapp_attempt_count integer not null default 0,

  loss_reason crm.loss_reason,
  loss_notes text,

  created_by uuid references crm.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proposals_id_workspace_key unique (id, workspace_id),
  constraint proposals_deal_fk foreign key (deal_id, workspace_id)
    references crm.deals (id, workspace_id) on delete cascade,
  constraint proposals_title_not_blank check (length(trim(title)) > 0),
  constraint proposals_amount_non_negative check (amount is null or amount >= 0),
  constraint proposals_sent_at_requires_sent_status check (
    sent_at is null or status in ('sent', 'revision_requested', 'revised', 'accepted', 'rejected', 'withdrawn', 'expired')
  ),
  constraint proposals_email_send_status_valid check (
    email_send_status in ('not_applicable', 'pending', 'skipped', 'sent', 'failed')
  ),
  constraint proposals_whatsapp_send_status_valid check (
    whatsapp_send_status in ('not_applicable', 'skipped', 'queued', 'sending', 'sent', 'failed')
  ),
  constraint proposals_loss_has_reason check (status not in ('rejected', 'expired') or loss_reason is not null)
);

create index proposals_deal_id_idx on crm.proposals (deal_id, updated_at desc);
create index proposals_workspace_status_idx on crm.proposals (workspace_id, status);
create index proposals_owner_status_idx on crm.proposals (owner_id, status);
create index proposals_follow_up_idx on crm.proposals (follow_up_at) where follow_up_at is not null;
create index proposals_whatsapp_send_queue_idx on crm.proposals (whatsapp_next_attempt_at)
  where whatsapp_send_status = 'queued';

-- Append-only history. company_id is set only on company-level events (they go with the
-- company); contact events carry contact_id, and deal events carry both deal_id and contact_id
-- so they survive a deal delete.
create table crm.timeline_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces (id) on delete cascade,
  company_id uuid,
  contact_id uuid,
  deal_id uuid,
  occurred_at timestamptz not null default now(),
  event_kind text not null,
  title text not null,
  detail text,
  actor_id uuid references crm.profiles (id) on delete set null,
  actor_name text not null,
  actor_source crm.actor_source not null,
  related_task_id uuid,
  related_meeting_id uuid,
  related_proposal_id uuid,
  related_call_id uuid,
  -- FK added in 006.
  related_workflow_run_id uuid,
  metadata jsonb,
  external_source text,
  external_id text,
  created_at timestamptz not null default now(),
  constraint timeline_events_company_fk foreign key (company_id, workspace_id)
    references crm.companies (id, workspace_id) on delete cascade,
  constraint timeline_events_contact_fk foreign key (contact_id, workspace_id)
    references crm.contacts (id, workspace_id) on delete cascade,
  constraint timeline_events_deal_fk foreign key (deal_id, workspace_id)
    references crm.deals (id, workspace_id) on delete set null (deal_id),
  constraint timeline_events_task_fk foreign key (related_task_id, workspace_id)
    references crm.tasks (id, workspace_id) on delete set null (related_task_id),
  constraint timeline_events_meeting_fk foreign key (related_meeting_id, workspace_id)
    references crm.meetings (id, workspace_id) on delete set null (related_meeting_id),
  constraint timeline_events_proposal_fk foreign key (related_proposal_id, workspace_id)
    references crm.proposals (id, workspace_id) on delete set null (related_proposal_id),
  constraint timeline_events_call_fk foreign key (related_call_id, workspace_id)
    references crm.calls (id, workspace_id) on delete set null (related_call_id),
  constraint timeline_events_has_subject check (company_id is not null or contact_id is not null),
  constraint timeline_events_deal_has_contact check (deal_id is null or contact_id is not null),
  constraint timeline_events_kind_not_blank check (length(trim(event_kind)) > 0),
  constraint timeline_events_title_not_blank check (length(trim(title)) > 0),
  constraint timeline_events_external_pair check ((external_source is null) = (external_id is null))
);

create index timeline_events_company_id_idx on crm.timeline_events (company_id, occurred_at desc)
  where company_id is not null;
create index timeline_events_contact_id_idx on crm.timeline_events (contact_id, occurred_at desc)
  where contact_id is not null;
create index timeline_events_deal_id_idx on crm.timeline_events (deal_id, occurred_at desc)
  where deal_id is not null;
create index timeline_events_actor_id_idx on crm.timeline_events (actor_id) where actor_id is not null;
create index timeline_events_related_task_id_idx on crm.timeline_events (related_task_id)
  where related_task_id is not null;
create index timeline_events_related_meeting_id_idx on crm.timeline_events (related_meeting_id)
  where related_meeting_id is not null;
create index timeline_events_related_proposal_id_idx on crm.timeline_events (related_proposal_id)
  where related_proposal_id is not null;
create index timeline_events_related_call_id_idx on crm.timeline_events (related_call_id)
  where related_call_id is not null;
create unique index timeline_events_workspace_external_key
  on crm.timeline_events (workspace_id, external_source, external_id)
  where external_id is not null;

create table crm.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces (id) on delete cascade,
  recipient_id uuid not null references crm.profiles (id) on delete cascade,
  contact_id uuid,
  deal_id uuid,
  title text not null,
  detail text,
  kind crm.notification_kind not null default 'info',
  href text,
  read boolean not null default false,
  created_at timestamptz not null default now(),
  constraint notifications_contact_fk foreign key (contact_id, workspace_id)
    references crm.contacts (id, workspace_id) on delete cascade,
  constraint notifications_deal_fk foreign key (deal_id, workspace_id)
    references crm.deals (id, workspace_id) on delete cascade,
  constraint notifications_title_not_blank check (length(trim(title)) > 0)
);

create index notifications_recipient_unread_idx
  on crm.notifications (recipient_id, workspace_id, read, created_at desc);
create index notifications_contact_id_idx on crm.notifications (contact_id) where contact_id is not null;
create index notifications_deal_id_idx on crm.notifications (deal_id) where deal_id is not null;

commit;
