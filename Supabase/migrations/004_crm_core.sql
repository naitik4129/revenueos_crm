-- 004_crm_core.sql
-- companies, contacts (+ consent), contact_channels, dnc_events, deals.
--
-- Cross-workspace safety: parents expose unique (id, workspace_id) and children reference
-- them with composite FKs (x_id, workspace_id), so a row can only point at rows in its own
-- workspace. Optional links use `on delete set null (x_id)` so workspace_id is kept.

begin;

create table crm.companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces (id) on delete cascade,
  name text not null,
  domain text,
  website text,
  industry text,
  phone text,
  city text,
  country text,
  owner_id uuid references crm.profiles (id) on delete set null,
  source crm.lead_source,
  external_source text,
  external_id text,
  created_by uuid references crm.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_id_workspace_key unique (id, workspace_id),
  constraint companies_name_not_blank check (length(trim(name)) > 0),
  constraint companies_domain_not_blank check (domain is null or length(trim(domain)) > 0),
  constraint companies_external_pair check ((external_source is null) = (external_id is null))
);

create unique index companies_workspace_domain_key on crm.companies (workspace_id, lower(domain))
  where domain is not null;
create unique index companies_workspace_external_key on crm.companies (workspace_id, external_source, external_id)
  where external_id is not null;
create index companies_workspace_name_idx on crm.companies (workspace_id, lower(name));
create index companies_owner_id_idx on crm.companies (owner_id) where owner_id is not null;

create table crm.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces (id) on delete cascade,
  company_id uuid,
  first_name text not null,
  last_name text not null default '',
  job_title text,
  email text,
  phone text,
  phone_e164 text,
  owner_id uuid references crm.profiles (id) on delete set null,
  source crm.lead_source not null default 'other',

  -- Consent lives on the contact. dnc_* is the current snapshot; history is in dnc_events
  -- (written by the trigger in 009).
  status crm.contact_status not null default 'active',
  dnc_reason text,
  dnc_by uuid references crm.profiles (id) on delete set null,
  dnc_by_name text,
  dnc_at timestamptz,
  merged_into_contact_id uuid,

  external_source text,
  external_id text,
  last_activity_at timestamptz not null default now(),
  created_by uuid references crm.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint contacts_id_workspace_key unique (id, workspace_id),
  constraint contacts_company_fk foreign key (company_id, workspace_id)
    references crm.companies (id, workspace_id) on delete set null (company_id),
  constraint contacts_merged_into_fk foreign key (merged_into_contact_id, workspace_id)
    references crm.contacts (id, workspace_id) on delete set null (merged_into_contact_id),
  constraint contacts_first_name_not_blank check (length(trim(first_name)) > 0),
  constraint contacts_email_not_blank check (email is null or length(trim(email)) > 0),
  constraint contacts_has_email_or_phone check (
    (email is not null) or (phone is not null and length(trim(phone)) > 0)
  ),
  constraint contacts_phone_e164_valid check (phone_e164 is null or phone_e164 ~ '^[+][1-9][0-9]{7,14}$'),
  constraint contacts_dnc_has_reason check (status <> 'do_not_contact' or dnc_reason is not null),
  constraint contacts_merged_into_only_when_merged check (merged_into_contact_id is null or status = 'merged'),
  constraint contacts_merge_target_not_self check (merged_into_contact_id is null or merged_into_contact_id <> id),
  constraint contacts_external_pair check ((external_source is null) = (external_id is null))
);

create unique index contacts_workspace_email_key on crm.contacts (workspace_id, lower(email))
  where email is not null;
create unique index contacts_workspace_phone_key on crm.contacts (workspace_id, phone_e164)
  where phone_e164 is not null;
create unique index contacts_workspace_external_key on crm.contacts (workspace_id, external_source, external_id)
  where external_id is not null;
create index contacts_company_id_idx on crm.contacts (company_id) where company_id is not null;
create index contacts_owner_id_idx on crm.contacts (owner_id) where owner_id is not null;
create index contacts_workspace_status_idx on crm.contacts (workspace_id, status);

create table crm.contact_channels (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references crm.contacts (id) on delete cascade,
  channel crm.contact_channel not null,
  status text not null,
  reason text,
  updated_by uuid references crm.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint contact_channels_unique_channel unique (contact_id, channel),
  constraint contact_channels_valid_status check (
    (channel = 'phone' and status in
      ('valid', 'reachable', 'temporarily_unreachable', 'invalid', 'wrong_number', 'do_not_contact'))
    or (channel = 'email' and status in
      ('valid', 'delivered', 'temporary_bounce', 'permanent_bounce', 'unsubscribed', 'invalid'))
    or (channel = 'whatsapp' and status in
      ('valid', 'reachable', 'temporarily_unreachable', 'invalid', 'opted_out', 'do_not_contact'))
  )
);

-- Append-only; written by the contacts trigger in 009, never directly.
create table crm.dnc_events (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references crm.contacts (id) on delete cascade,
  action text not null,
  reason text,
  actor_id uuid references crm.profiles (id) on delete set null,
  actor_name text,
  created_at timestamptz not null default now(),
  constraint dnc_events_action_valid check (action in ('suppressed', 'reactivated'))
);

create index dnc_events_contact_id_idx on crm.dnc_events (contact_id, created_at desc);

create table crm.deals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces (id) on delete cascade,
  contact_id uuid not null,
  company_id uuid,
  owner_id uuid references crm.profiles (id) on delete set null,
  service_interest text,

  -- Stage, outcome, automation and response are independent on purpose.
  stage crm.pipeline_stage not null default 'new',
  outcome crm.deal_outcome not null default 'open',
  automation_mode crm.automation_mode not null default 'manual',
  response_state crm.response_state not null default 'no_response',

  objection_type crm.objection_type,
  interested_later_reason text,
  interested_later_restart_at date,
  interested_later_next_action text,
  interested_later_decision_owner text,
  loss_reason crm.loss_reason,
  loss_notes text,

  external_source text,
  external_id text,
  last_activity_at timestamptz not null default now(),
  created_by uuid references crm.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint deals_id_workspace_key unique (id, workspace_id),
  constraint deals_contact_fk foreign key (contact_id, workspace_id)
    references crm.contacts (id, workspace_id) on delete cascade,
  constraint deals_company_fk foreign key (company_id, workspace_id)
    references crm.companies (id, workspace_id) on delete set null (company_id),
  constraint deals_lost_has_reason check (outcome <> 'lost' or loss_reason is not null),
  constraint deals_objection_stage_has_type check (stage <> 'objection_nurture' or objection_type is not null),
  constraint deals_external_pair check ((external_source is null) = (external_id is null))
);

-- Max one open deal per contact. 'nurture' is parked, not open, so reopening one fails
-- here while another deal is open.
create unique index deals_one_open_per_contact on crm.deals (workspace_id, contact_id)
  where outcome = 'open';
create unique index deals_workspace_external_key on crm.deals (workspace_id, external_source, external_id)
  where external_id is not null;
create index deals_contact_id_idx on crm.deals (contact_id);
create index deals_company_id_idx on crm.deals (company_id) where company_id is not null;
create index deals_owner_id_idx on crm.deals (owner_id) where owner_id is not null;
create index deals_workspace_outcome_stage_idx on crm.deals (workspace_id, outcome, stage);
create index deals_interested_later_restart_idx on crm.deals (interested_later_restart_at)
  where interested_later_restart_at is not null;

commit;
