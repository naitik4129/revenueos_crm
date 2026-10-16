-- 011_crm_brain_intake.sql
-- The CRM holds all brain data: QuickICP companies/people (as prospects), Quickhowl AI calls,
-- Email Tool campaign emails, and qualified handovers. The brain writes only through the
-- CRM API (/brain/v1), authenticated by a per-workspace key.
--
-- Adds: lifecycle stage on contacts, crm.external_refs (one company/contact can have ids in
-- several tools), AI-call fields on calls, crm.email_activities, crm.brain_api_keys,
-- workspaces.default_owner_id. Drops external_source/external_id from companies and contacts.

begin;

-- Enums ----------------------------------------------------------------------

-- Declaration order matters: code moves a contact forward with `lifecycle_stage < $new`.
create type crm.lifecycle_stage as enum ('prospect', 'contacted', 'engaged', 'qualified', 'customer');

create type crm.call_source as enum ('human', 'ai');

-- Declaration order is the status precedence (later wins), so events arriving out of order
-- never move the status backwards.
create type crm.email_status as enum ('sent', 'delivered', 'opened', 'replied', 'bounced', 'unsubscribed');

alter type crm.lead_source add value 'brain';

-- Prospects never auto-enroll in a workflow; only deals do.
alter type crm.workflow_trigger rename value 'lead_created' to 'deal_created';

-- Workspaces -----------------------------------------------------------------

-- Owner of brain handovers when the payload's ownerEmail is not a member. NULL = unassigned.
alter table crm.workspaces
  add column default_owner_id uuid references crm.profiles (id) on delete set null;

-- Companies ------------------------------------------------------------------

alter table crm.companies
  drop constraint companies_external_pair,
  drop column external_source,
  drop column external_id,
  add column headcount integer,
  add column linkedin_url text,
  add column location text,
  add constraint companies_headcount_non_negative check (headcount is null or headcount >= 0);

-- Contacts -------------------------------------------------------------------

alter table crm.contacts
  drop constraint contacts_external_pair,
  drop column external_source,
  drop column external_id,
  drop constraint contacts_has_email_or_phone,
  add column lifecycle_stage crm.lifecycle_stage not null default 'prospect',
  add column lifecycle_changed_at timestamptz not null default now(),
  add column linkedin_url text,
  add column country text,
  add column location text,
  -- Some QuickICP people have only a LinkedIn profile.
  add constraint contacts_has_identifier check (
    email is not null
    or (phone is not null and length(trim(phone)) > 0)
    or (linkedin_url is not null and length(trim(linkedin_url)) > 0)
  );

create index contacts_workspace_lifecycle_idx on crm.contacts (workspace_id, lifecycle_stage);

-- External refs ----------------------------------------------------------------
-- Exactly one of company_id / contact_id. Rows go with their entity (cascade); merge code
-- moves a merged contact's refs to the target.

create table crm.external_refs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces (id) on delete cascade,
  company_id uuid,
  contact_id uuid,
  source text not null,
  external_id text not null,
  created_at timestamptz not null default now(),
  constraint external_refs_company_fk foreign key (company_id, workspace_id)
    references crm.companies (id, workspace_id) on delete cascade,
  constraint external_refs_contact_fk foreign key (contact_id, workspace_id)
    references crm.contacts (id, workspace_id) on delete cascade,
  constraint external_refs_exactly_one_entity check ((company_id is null) <> (contact_id is null)),
  -- Add a source here when the brain gets a new tool.
  constraint external_refs_source_valid check (source in ('quickicp', 'quickhowl', 'email_tool')),
  constraint external_refs_external_id_not_blank check (length(trim(external_id)) > 0)
);

create unique index external_refs_company_key on crm.external_refs (workspace_id, source, external_id)
  where company_id is not null;
create unique index external_refs_contact_key on crm.external_refs (workspace_id, source, external_id)
  where contact_id is not null;
create index external_refs_company_id_idx on crm.external_refs (company_id) where company_id is not null;
create index external_refs_contact_id_idx on crm.external_refs (contact_id) where contact_id is not null;

-- Calls (AI calls from Quickhowl) ------------------------------------------------
-- AI calls are activity only: they keep Quickhowl's raw outcome in ai_outcome and skip the
-- human outcome rule.

alter table crm.calls
  add column source crm.call_source not null default 'human',
  add column direction text,
  add column occurred_at timestamptz not null default now(),
  add column duration_seconds integer,
  add column ai_outcome text,
  add column summary text,
  add column sentiment text,
  add column transcript text,
  add column recording_url text,
  add constraint calls_direction_valid check (direction is null or direction in ('outbound', 'inbound')),
  add constraint calls_duration_non_negative check (duration_seconds is null or duration_seconds >= 0),
  drop constraint calls_outcome_matches_connection,
  add constraint calls_outcome_matches_connection check (
    source = 'ai'
    or (connected = false and not_connected_reason is not null and connected_outcome is null)
    or (connected = true and connected_outcome is not null and not_connected_reason is null)
  );

drop index crm.calls_contact_id_idx;
create index calls_contact_id_idx on crm.calls (contact_id, occurred_at desc);

-- Email activities ---------------------------------------------------------------

create table crm.email_activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces (id) on delete cascade,
  contact_id uuid not null,
  deal_id uuid,
  external_source text,
  external_id text,
  campaign_ref text,
  campaign_name text,
  step integer,
  subject text,
  status crm.email_status not null default 'sent',
  reply_text text,
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  replied_at timestamptz,
  bounced_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_activities_contact_fk foreign key (contact_id, workspace_id)
    references crm.contacts (id, workspace_id) on delete cascade,
  constraint email_activities_deal_fk foreign key (deal_id, workspace_id)
    references crm.deals (id, workspace_id) on delete set null (deal_id),
  constraint email_activities_external_pair check ((external_source is null) = (external_id is null)),
  constraint email_activities_step_positive check (step is null or step > 0)
);

create unique index email_activities_workspace_external_key
  on crm.email_activities (workspace_id, external_source, external_id)
  where external_id is not null;
create index email_activities_contact_id_idx on crm.email_activities (contact_id, created_at desc);
create index email_activities_deal_id_idx on crm.email_activities (deal_id) where deal_id is not null;
create index email_activities_workspace_campaign_idx on crm.email_activities (workspace_id, campaign_ref)
  where campaign_ref is not null;

create trigger email_activities_set_updated_at
  before update on crm.email_activities
  for each row execute function crm.set_updated_at();

-- Brain API keys -----------------------------------------------------------------
-- Only the SHA-256 hash is stored; the plain key is shown once at creation.

create table crm.brain_api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces (id) on delete cascade,
  key_hash text not null unique,
  key_prefix text not null,
  label text not null,
  created_by uuid references crm.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint brain_api_keys_label_not_blank check (length(trim(label)) > 0)
);

create index brain_api_keys_workspace_idx on crm.brain_api_keys (workspace_id);

-- RLS + grants (same rules as 010) ---------------------------------------------------
-- crm_app (BYPASSRLS) gets DML through the default privileges from 001.

alter table crm.external_refs enable row level security;
alter table crm.email_activities enable row level security;
alter table crm.brain_api_keys enable row level security;

revoke all on crm.external_refs, crm.email_activities, crm.brain_api_keys from public, anon, authenticated;

do $$
declare
  n int;
begin
  select count(*) into n from pg_tables where schemaname = 'crm';
  if n <> 35 then
    raise exception 'Expected 35 crm tables, found %', n;
  end if;
  select count(*) into n from pg_tables where schemaname = 'crm' and not rowsecurity;
  if n <> 0 then
    raise exception '% crm tables without RLS', n;
  end if;
end $$;

commit;
