-- =============================================================================
-- Northbeam CRM -- multi-workspace architecture
-- =============================================================================
--
-- Introduces public.workspaces and workspace_id scoping across the CRM,
-- while preserving every existing row: this app has been single-tenant
-- until now, so 100% of existing data belongs to exactly one workspace
-- (MOTM, seeded below with a fixed UUID). Every backfill in this file is
-- therefore a flat "set workspace_id = the MOTM id for every existing row"
-- -- no cross-table joins are needed to figure out which workspace a row
-- belongs to, because there has only ever been one.
--
-- Written to be safe to re-run: create table/index use IF NOT EXISTS, the
-- seed insert uses ON CONFLICT DO NOTHING, every alter table add column
-- uses IF NOT EXISTS, and every backfill is guarded by
-- "where workspace_id is null" so a second run is a no-op.
--
-- Scope decision (see the multi-workspace architecture plan): only genuinely
-- independent root entities get a direct workspace_id column. Tables that
-- only ever exist as a tightly-owned child of one of those roots (lead_notes,
-- lead_contact_channels, timeline_events, dnc_events, meeting_participants,
-- template_attachments, workflow_versions, workflow_steps) inherit workspace
-- scope transitively through their existing FK -- the backend already joins
-- to the parent in every query that touches them, so no schema change is
-- needed there. profiles and admin_audit_events are intentionally
-- unchanged: every active salesperson can already access every workspace
-- (no membership table), and admin actions (user management) are
-- workspace-agnostic under the new model.

-- -----------------------------------------------------------------------------
-- Part 1 -- workspaces table, seeded with the existing single tenant as MOTM
-- -----------------------------------------------------------------------------

create table if not exists public.workspaces (
  id uuid primary key,
  name text not null,
  slug text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint workspaces_name_not_blank check (length(trim(name)) > 0),
  constraint workspaces_slug_not_blank check (length(trim(slug)) > 0),
  constraint workspaces_name_unique unique (name),
  constraint workspaces_slug_unique unique (slug)
);

comment on table public.workspaces is
  'A tenant/brand operating through this CRM. Every active salesperson can access every '
  'workspace -- there is no per-user membership table (see architecture plan) -- so this table '
  'exists purely to partition business data and integration config, not to gate authorization.';

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'workspaces_set_updated_at') then
    create trigger workspaces_set_updated_at
      before update on public.workspaces
      for each row
      execute function public.set_updated_at();
  end if;
end $$;

alter table public.workspaces enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspaces' and policyname = 'workspaces_select_active_salesperson') then
    create policy workspaces_select_active_salesperson
      on public.workspaces for select to authenticated
      using (public.is_active_salesperson());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspaces' and policyname = 'workspaces_insert_active_salesperson') then
    create policy workspaces_insert_active_salesperson
      on public.workspaces for insert to authenticated
      with check (public.is_active_salesperson());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspaces' and policyname = 'workspaces_update_active_salesperson') then
    create policy workspaces_update_active_salesperson
      on public.workspaces for update to authenticated
      using (public.is_active_salesperson()) with check (public.is_active_salesperson());
  end if;
end $$;

-- Fixed, deterministic id (not gen_random_uuid()) so every backfill step
-- below, and any re-run of this file, is idempotent and unambiguous.
insert into public.workspaces (id, name, slug)
values ('00000000-0000-0000-0000-000000000001', 'MOTM', 'motm')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Part 2 -- direct workspace_id on independent root/business entities
-- -----------------------------------------------------------------------------

-- leads
alter table public.leads add column if not exists workspace_id uuid references public.workspaces (id);
update public.leads set workspace_id = '00000000-0000-0000-0000-000000000001' where workspace_id is null;
alter table public.leads alter column workspace_id set not null;
create index if not exists leads_workspace_id_idx on public.leads (workspace_id);

-- calls
alter table public.calls add column if not exists workspace_id uuid references public.workspaces (id);
update public.calls set workspace_id = '00000000-0000-0000-0000-000000000001' where workspace_id is null;
alter table public.calls alter column workspace_id set not null;
create index if not exists calls_workspace_id_idx on public.calls (workspace_id);

-- tasks
alter table public.tasks add column if not exists workspace_id uuid references public.workspaces (id);
update public.tasks set workspace_id = '00000000-0000-0000-0000-000000000001' where workspace_id is null;
alter table public.tasks alter column workspace_id set not null;
create index if not exists tasks_workspace_id_idx on public.tasks (workspace_id);

-- meetings
alter table public.meetings add column if not exists workspace_id uuid references public.workspaces (id);
update public.meetings set workspace_id = '00000000-0000-0000-0000-000000000001' where workspace_id is null;
alter table public.meetings alter column workspace_id set not null;
create index if not exists meetings_workspace_id_idx on public.meetings (workspace_id);

-- proposals
alter table public.proposals add column if not exists workspace_id uuid references public.workspaces (id);
update public.proposals set workspace_id = '00000000-0000-0000-0000-000000000001' where workspace_id is null;
alter table public.proposals alter column workspace_id set not null;
create index if not exists proposals_workspace_id_idx on public.proposals (workspace_id);

-- workflows
alter table public.workflows add column if not exists workspace_id uuid references public.workspaces (id);
update public.workflows set workspace_id = '00000000-0000-0000-0000-000000000001' where workspace_id is null;
alter table public.workflows alter column workspace_id set not null;
create index if not exists workflows_workspace_id_idx on public.workflows (workspace_id);

-- workflow_runs
alter table public.workflow_runs add column if not exists workspace_id uuid references public.workspaces (id);
update public.workflow_runs set workspace_id = '00000000-0000-0000-0000-000000000001' where workspace_id is null;
alter table public.workflow_runs alter column workspace_id set not null;
create index if not exists workflow_runs_workspace_id_idx on public.workflow_runs (workspace_id);

-- scheduled_actions
alter table public.scheduled_actions add column if not exists workspace_id uuid references public.workspaces (id);
update public.scheduled_actions set workspace_id = '00000000-0000-0000-0000-000000000001' where workspace_id is null;
alter table public.scheduled_actions alter column workspace_id set not null;
create index if not exists scheduled_actions_workspace_id_idx on public.scheduled_actions (workspace_id);

-- message_templates
alter table public.message_templates add column if not exists workspace_id uuid references public.workspaces (id);
update public.message_templates set workspace_id = '00000000-0000-0000-0000-000000000001' where workspace_id is null;
alter table public.message_templates alter column workspace_id set not null;
create index if not exists message_templates_workspace_id_idx on public.message_templates (workspace_id);

-- notifications: nullable, matching the table's existing nullable lead_id
-- (a notification is not strictly guaranteed to be about a specific lead).
alter table public.notifications add column if not exists workspace_id uuid references public.workspaces (id);
update public.notifications set workspace_id = '00000000-0000-0000-0000-000000000001' where workspace_id is null;
create index if not exists notifications_workspace_id_idx on public.notifications (workspace_id) where workspace_id is not null;

-- whatsapp_outbound_messages: workspace_id needed directly (not just via its
-- scheduled_action/proposal/meeting parent) so the per-workspace daily-cap
-- and send-spacing queries in the WhatsApp provider don't need an extra join
-- on their hot path.
alter table public.whatsapp_outbound_messages add column if not exists workspace_id uuid references public.workspaces (id);
update public.whatsapp_outbound_messages set workspace_id = '00000000-0000-0000-0000-000000000001' where workspace_id is null;
alter table public.whatsapp_outbound_messages alter column workspace_id set not null;
create index if not exists whatsapp_outbound_messages_workspace_id_idx on public.whatsapp_outbound_messages (workspace_id);

-- whatsapp_inbound_events: workspace is determined by which workspace's
-- Baileys socket received the message (set explicitly by the inbound
-- handler going forward), not by a lead match -- this table has no lead_id
-- column at all (metadata-only by design, see 003_admin_integrations_baileys.sql).
alter table public.whatsapp_inbound_events add column if not exists workspace_id uuid references public.workspaces (id);
update public.whatsapp_inbound_events set workspace_id = '00000000-0000-0000-0000-000000000001' where workspace_id is null;
alter table public.whatsapp_inbound_events alter column workspace_id set not null;
create index if not exists whatsapp_inbound_events_workspace_id_idx on public.whatsapp_inbound_events (workspace_id);

-- deleted_leads_audit: nullable and no FK-enforced relationship to any other
-- workspace-owned row (it deliberately has no FK to leads either, so it
-- survives the delete cascade it's recording) -- a FK to workspaces itself
-- is safe though, since workspaces are never hard-deleted in this design.
alter table public.deleted_leads_audit add column if not exists workspace_id uuid references public.workspaces (id);
update public.deleted_leads_audit set workspace_id = '00000000-0000-0000-0000-000000000001' where workspace_id is null;
create index if not exists deleted_leads_audit_workspace_id_idx on public.deleted_leads_audit (workspace_id) where workspace_id is not null;

-- -----------------------------------------------------------------------------
-- Part 3 -- integration connection tables: singleton -> workspace-keyed
-- -----------------------------------------------------------------------------
-- Each of these was previously a schema-enforced singleton (id boolean/text
-- primary key with a CHECK that made a second row impossible) -- exactly one
-- email connection, one WhatsApp session, one Google Calendar connection for
-- the entire app. They become one row per workspace: the existing single row
-- is backfilled to MOTM and its old id-based PK is replaced with a
-- workspace-keyed PK.

-- integration_connections (email; id keeps discriminating provider "kind"
-- within a workspace, so the new PK is the composite (workspace_id, id)).
alter table public.integration_connections add column if not exists workspace_id uuid references public.workspaces (id);
update public.integration_connections set workspace_id = '00000000-0000-0000-0000-000000000001' where workspace_id is null;
alter table public.integration_connections alter column workspace_id set not null;
alter table public.integration_connections drop constraint if exists integration_connections_pkey;
alter table public.integration_connections add constraint integration_connections_pkey primary key (workspace_id, id);

-- whatsapp_connection: true singleton -> workspace_id becomes the PK; the
-- old `id boolean` column carried no information beyond "this is the one row".
alter table public.whatsapp_connection add column if not exists workspace_id uuid references public.workspaces (id);
update public.whatsapp_connection set workspace_id = '00000000-0000-0000-0000-000000000001' where workspace_id is null;
alter table public.whatsapp_connection alter column workspace_id set not null;
alter table public.whatsapp_connection drop constraint if exists whatsapp_connection_pkey;
alter table public.whatsapp_connection drop column if exists id;
alter table public.whatsapp_connection add constraint whatsapp_connection_pkey primary key (workspace_id);

-- whatsapp_auth_credentials: same singleton pattern as whatsapp_connection.
alter table public.whatsapp_auth_credentials add column if not exists workspace_id uuid references public.workspaces (id);
update public.whatsapp_auth_credentials set workspace_id = '00000000-0000-0000-0000-000000000001' where workspace_id is null;
alter table public.whatsapp_auth_credentials alter column workspace_id set not null;
alter table public.whatsapp_auth_credentials drop constraint if exists whatsapp_auth_credentials_pkey;
alter table public.whatsapp_auth_credentials drop column if exists id;
alter table public.whatsapp_auth_credentials add constraint whatsapp_auth_credentials_pkey primary key (workspace_id);

-- whatsapp_auth_keys: was keyed by (key_type, key_id) alone -> extend to
-- (workspace_id, key_type, key_id) so each workspace's Baileys session keeps
-- its own independent Signal protocol key material.
alter table public.whatsapp_auth_keys add column if not exists workspace_id uuid references public.workspaces (id);
update public.whatsapp_auth_keys set workspace_id = '00000000-0000-0000-0000-000000000001' where workspace_id is null;
alter table public.whatsapp_auth_keys alter column workspace_id set not null;
alter table public.whatsapp_auth_keys drop constraint if exists whatsapp_auth_keys_pkey;
alter table public.whatsapp_auth_keys add constraint whatsapp_auth_keys_pkey primary key (workspace_id, key_type, key_id);

-- google_calendar_connection: same singleton pattern as whatsapp_connection.
alter table public.google_calendar_connection add column if not exists workspace_id uuid references public.workspaces (id);
update public.google_calendar_connection set workspace_id = '00000000-0000-0000-0000-000000000001' where workspace_id is null;
alter table public.google_calendar_connection alter column workspace_id set not null;
alter table public.google_calendar_connection drop constraint if exists google_calendar_connection_pkey;
alter table public.google_calendar_connection drop column if exists id;
alter table public.google_calendar_connection add constraint google_calendar_connection_pkey primary key (workspace_id);

-- -----------------------------------------------------------------------------
-- Part 4 -- no RLS policy changes on existing tables
-- -----------------------------------------------------------------------------
-- is_active_salesperson() and every existing RLS policy stay exactly as they
-- are: RLS here is defense-in-depth only (the backend's own Postgres
-- connection bypasses RLS -- see context.md), and every active salesperson
-- is already entitled to access every workspace (no membership table), so
-- workspace scoping is enforced in the backend's application code
-- (authMiddleware.ts's requireWorkspace + workspace_id filters in every
-- service query), not as a new Postgres-level authorization boundary.
