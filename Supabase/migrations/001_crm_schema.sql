-- 001_crm_schema.sql
-- Creates schema `crm` and gives the backend role `crm_app` rights on it (and nothing else).
-- Requires 000_platform_grants.sql to have been run first.

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_app') then
    raise exception 'Role crm_app does not exist. Run 000_platform_grants.sql first (needs platform approval).';
  end if;
end $$;

create schema crm;

revoke all on schema crm from public, anon, authenticated;
grant usage on schema crm to crm_app;

-- Tables created later in this schema (by the role running these files) are granted automatically.
alter default privileges in schema crm grant select, insert, update, delete on tables to crm_app;
alter default privileges in schema crm grant usage, select on sequences to crm_app;
alter default privileges in schema crm revoke execute on functions from public;

commit;
