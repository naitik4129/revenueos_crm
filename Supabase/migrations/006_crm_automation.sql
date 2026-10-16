-- 006_crm_automation.sql
-- message_templates + attachments, workflows / versions / steps, workflow_runs,
-- scheduled_actions, plus the FKs deferred from 003 and 005.

begin;

create table crm.message_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces (id) on delete cascade,
  name text not null,
  channel crm.template_channel not null,
  subject text,
  body text not null,
  is_active boolean not null default true,
  created_by uuid references crm.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_templates_id_workspace_key unique (id, workspace_id),
  constraint message_templates_name_not_blank check (length(trim(name)) > 0),
  constraint message_templates_body_not_blank check (length(trim(body)) > 0),
  constraint message_templates_whatsapp_no_subject check (channel <> 'whatsapp' or subject is null)
);

create index message_templates_workspace_channel_idx on crm.message_templates (workspace_id, channel, is_active);

-- Files live in the private bucket crm-template-attachments.
create table crm.template_attachments (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references crm.message_templates (id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes integer not null,
  created_at timestamptz not null default now(),
  constraint template_attachments_file_name_not_blank check (length(trim(file_name)) > 0),
  constraint template_attachments_size_positive check (size_bytes > 0)
);

create index template_attachments_template_id_idx on crm.template_attachments (template_id);

create table crm.workflows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces (id) on delete cascade,
  name text not null,
  description text,
  trigger crm.workflow_trigger not null,
  status crm.workflow_status not null default 'paused',
  owner_id uuid references crm.profiles (id) on delete set null,
  created_by uuid references crm.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflows_id_workspace_key unique (id, workspace_id),
  constraint workflows_name_not_blank check (length(trim(name)) > 0)
);

create index workflows_workspace_trigger_status_idx on crm.workflows (workspace_id, trigger, status);

create table crm.workflow_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces (id) on delete cascade,
  workflow_id uuid not null,
  version_number integer not null,
  status crm.workflow_version_status not null default 'draft',
  created_by uuid references crm.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  constraint workflow_versions_id_workspace_key unique (id, workspace_id),
  -- Lets workflow_runs prove its version belongs to its workflow.
  constraint workflow_versions_id_workflow_key unique (id, workflow_id),
  constraint workflow_versions_workflow_fk foreign key (workflow_id, workspace_id)
    references crm.workflows (id, workspace_id) on delete cascade,
  constraint workflow_versions_number_positive check (version_number > 0),
  constraint workflow_versions_unique_number unique (workflow_id, version_number),
  constraint workflow_versions_published_at_matches_status check (
    (status = 'draft' and published_at is null)
    or (status in ('published', 'previous') and published_at is not null)
  )
);

create unique index workflow_versions_one_draft_per_workflow on crm.workflow_versions (workflow_id)
  where status = 'draft';
create unique index workflow_versions_one_published_per_workflow on crm.workflow_versions (workflow_id)
  where status = 'published';

create table crm.workflow_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces (id) on delete cascade,
  workflow_version_id uuid not null,
  step_order integer not null,
  delay_days integer not null default 0,
  action crm.workflow_step_action not null,
  template_id uuid,
  config text,
  is_enabled boolean not null default true,
  constraint workflow_steps_id_workspace_key unique (id, workspace_id),
  constraint workflow_steps_version_fk foreign key (workflow_version_id, workspace_id)
    references crm.workflow_versions (id, workspace_id) on delete cascade,
  constraint workflow_steps_template_fk foreign key (template_id, workspace_id)
    references crm.message_templates (id, workspace_id) on delete set null (template_id),
  constraint workflow_steps_order_non_negative check (step_order >= 0),
  constraint workflow_steps_delay_non_negative check (delay_days >= 0),
  constraint workflow_steps_unique_order unique (workflow_version_id, step_order),
  constraint workflow_steps_template_only_on_message_action check (
    template_id is null or action in ('send_email', 'send_whatsapp')
  )
);

create index workflow_steps_template_id_idx on crm.workflow_steps (template_id) where template_id is not null;

-- Published versions are immutable: steps can only change while their version is a draft.
create function crm.enforce_workflow_steps_draft_only()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status crm.workflow_version_status;
begin
  select status into v_status
  from crm.workflow_versions
  where id = coalesce(new.workflow_version_id, old.workflow_version_id);

  if v_status is distinct from 'draft' then
    raise exception 'workflow_steps can only be modified while their workflow_version is Draft (version status: %)', v_status
      using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger workflow_steps_draft_only_edit
  before insert or update or delete on crm.workflow_steps
  for each row
  execute function crm.enforce_workflow_steps_draft_only();

create table crm.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces (id) on delete cascade,
  workflow_id uuid not null,
  workflow_version_id uuid not null,
  deal_id uuid not null,
  -- Copied from the deal at enrollment so consent checks need no join.
  contact_id uuid not null,
  current_step_id uuid,
  status crm.workflow_run_status not null default 'running',
  started_at timestamptz not null default now(),
  next_run_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  last_error text,
  created_by uuid references crm.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_runs_id_workspace_key unique (id, workspace_id),
  constraint workflow_runs_workflow_fk foreign key (workflow_id, workspace_id)
    references crm.workflows (id, workspace_id) on delete restrict,
  constraint workflow_runs_version_fk foreign key (workflow_version_id, workflow_id)
    references crm.workflow_versions (id, workflow_id) on delete restrict,
  constraint workflow_runs_deal_fk foreign key (deal_id, workspace_id)
    references crm.deals (id, workspace_id) on delete cascade,
  constraint workflow_runs_contact_fk foreign key (contact_id, workspace_id)
    references crm.contacts (id, workspace_id) on delete cascade,
  constraint workflow_runs_current_step_fk foreign key (current_step_id, workspace_id)
    references crm.workflow_steps (id, workspace_id) on delete set null (current_step_id),
  constraint workflow_runs_completed_at_matches_status check ((status = 'completed') = (completed_at is not null)),
  constraint workflow_runs_cancelled_at_matches_status check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint workflow_runs_failed_has_error check (status <> 'failed' or last_error is not null)
);

create index workflow_runs_deal_id_idx on crm.workflow_runs (deal_id);
create index workflow_runs_contact_id_idx on crm.workflow_runs (contact_id);
create index workflow_runs_workflow_id_idx on crm.workflow_runs (workflow_id);
create index workflow_runs_status_next_run_idx on crm.workflow_runs (status, next_run_at)
  where status in ('running', 'waiting');

create table crm.scheduled_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces (id) on delete cascade,
  deal_id uuid not null,
  workflow_run_id uuid not null,
  workflow_step_id uuid not null,
  action_type crm.workflow_step_action not null,
  scheduled_for timestamptz not null,
  status crm.scheduled_action_status not null default 'pending',
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
  constraint scheduled_actions_id_workspace_key unique (id, workspace_id),
  constraint scheduled_actions_deal_fk foreign key (deal_id, workspace_id)
    references crm.deals (id, workspace_id) on delete cascade,
  constraint scheduled_actions_run_fk foreign key (workflow_run_id, workspace_id)
    references crm.workflow_runs (id, workspace_id) on delete cascade,
  constraint scheduled_actions_step_fk foreign key (workflow_step_id, workspace_id)
    references crm.workflow_steps (id, workspace_id) on delete restrict,
  constraint scheduled_actions_unique_run_step unique (workflow_run_id, workflow_step_id),
  constraint scheduled_actions_attempt_count_non_negative check (attempt_count >= 0),
  constraint scheduled_actions_max_attempts_positive check (max_attempts > 0),
  constraint scheduled_actions_executed_at_matches_status check ((status = 'completed') = (executed_at is not null)),
  constraint scheduled_actions_cancelled_at_matches_status check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint scheduled_actions_failed_has_error check (status <> 'failed' or last_error is not null)
);

create index scheduled_actions_due_idx on crm.scheduled_actions (scheduled_for) where status in ('pending', 'due');
create index scheduled_actions_deal_id_idx on crm.scheduled_actions (deal_id);
create index scheduled_actions_workflow_run_id_idx on crm.scheduled_actions (workflow_run_id);

-- Deferred FKs -------------------------------------------------------------

-- Same-workspace templates only (composite FK uses the workspace's own id).
alter table crm.workspaces
  add constraint workspaces_default_meeting_email_template_fk
    foreign key (default_meeting_email_template_id, id)
    references crm.message_templates (id, workspace_id) on delete set null (default_meeting_email_template_id),
  add constraint workspaces_default_meeting_whatsapp_template_fk
    foreign key (default_meeting_whatsapp_template_id, id)
    references crm.message_templates (id, workspace_id) on delete set null (default_meeting_whatsapp_template_id);

alter table crm.proposals
  add constraint proposals_email_template_fk foreign key (email_template_id, workspace_id)
    references crm.message_templates (id, workspace_id) on delete set null (email_template_id),
  add constraint proposals_whatsapp_template_fk foreign key (whatsapp_template_id, workspace_id)
    references crm.message_templates (id, workspace_id) on delete set null (whatsapp_template_id);

alter table crm.tasks
  add constraint tasks_source_workflow_run_fk foreign key (source_workflow_run_id, workspace_id)
    references crm.workflow_runs (id, workspace_id) on delete set null (source_workflow_run_id),
  add constraint tasks_source_workflow_step_fk foreign key (source_workflow_step_id, workspace_id)
    references crm.workflow_steps (id, workspace_id) on delete set null (source_workflow_step_id);

create index tasks_source_workflow_run_idx on crm.tasks (source_workflow_run_id) where source_workflow_run_id is not null;
create index tasks_source_workflow_step_idx on crm.tasks (source_workflow_step_id) where source_workflow_step_id is not null;

alter table crm.timeline_events
  add constraint timeline_events_workflow_run_fk foreign key (related_workflow_run_id, workspace_id)
    references crm.workflow_runs (id, workspace_id) on delete set null (related_workflow_run_id);

create index timeline_events_related_workflow_run_id_idx on crm.timeline_events (related_workflow_run_id)
  where related_workflow_run_id is not null;

commit;
