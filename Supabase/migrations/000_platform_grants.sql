-- 000_platform_grants.sql
-- Run by a platform developer (as `postgres`), after the platform team approves.
-- Creates the role the CRM backend and worker log in as, and gives it the access it needs to the
-- platform tables. Rights on the crm_* tables are granted by crm_secure_objects() (001).
--
-- Safe to run again: the role is created only if missing, and re-granting is a no-op, so a later
-- grant (e.g. revenueos_project_members below) can be picked up by just re-running this file.
--
-- Afterwards set a password outside version control:
--   alter role crm_app with password '<strong secret>';
-- Through the Supabase pooler the user name is `crm_app.<project_ref>`.

begin;

-- BYPASSRLS: every crm_* table has RLS on with no policies (010); the backend enforces access.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_app') then
    create role crm_app with login bypassrls nosuperuser nocreatedb nocreaterole noinherit noreplication;
  end if;
end $$;

grant usage on schema public to crm_app;
grant select on public.revenueos_profiles, public.revenueos_projects to crm_app;
-- The CRM is driven by the platform: it READS who may use a project (revenueos_project_members,
-- platform migration 0014) to decide CRM access and which workspaces a person sees. Read-only.
grant select on public.revenueos_project_members to crm_app;

commit;
