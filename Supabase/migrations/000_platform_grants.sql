-- 000_platform_grants.sql
-- Run ONCE by a platform developer (as `postgres`), after the platform team approves.
-- Creates the role the CRM backend and worker log in as, and gives it read-only access
-- to the two platform tables the CRM needs. Rights on schema `crm` are granted in 001.
--
-- Afterwards set a password outside version control:
--   alter role crm_app with password '<strong secret>';
-- Through the Supabase pooler the user name is `crm_app.<project_ref>`.

begin;

-- BYPASSRLS: every crm table has RLS on with no policies (010); the backend enforces access.
create role crm_app with login bypassrls nosuperuser nocreatedb nocreaterole noinherit noreplication;

grant usage on schema public to crm_app;
grant select on public.revenueos_profiles, public.revenueos_projects to crm_app;

commit;
