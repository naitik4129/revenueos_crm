-- 003_crm_identity.sql
-- profiles (CRM access record), workspaces (one per client project), workspace_members.
-- Name/email are NOT stored here: they are read from public.revenueos_profiles.

begin;

create table crm.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role crm.user_role not null default 'salesperson',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index profiles_role_active_idx on crm.profiles (role, is_active);

create table crm.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  is_active boolean not null default true,
  -- public.revenueos_projects.id. No FK (other schema); the backend checks it exists.
  platform_project_id uuid unique,
  -- FKs to crm.message_templates are added in 006 (the table does not exist yet).
  default_meeting_email_template_id uuid,
  default_meeting_whatsapp_template_id uuid,
  created_by uuid references crm.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_name_not_blank check (length(trim(name)) > 0),
  constraint workspaces_slug_not_blank check (length(trim(slug)) > 0)
);

create unique index workspaces_name_lower_key on crm.workspaces (lower(name));

create table crm.workspace_members (
  workspace_id uuid not null references crm.workspaces (id) on delete cascade,
  user_id uuid not null references crm.profiles (id) on delete cascade,
  added_by uuid references crm.profiles (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_id_idx on crm.workspace_members (user_id);

commit;
