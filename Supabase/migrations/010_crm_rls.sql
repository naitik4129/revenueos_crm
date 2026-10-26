-- 010_crm_rls.sql
-- Checks that every crm_* table has RLS on with NO policies and no rights for the Data API roles.
--
-- The backend still reads and writes everything: it connects as crm_app, created with
-- BYPASSRLS in 000_platform_grants.sql, so RLS does not apply to it. anon, authenticated and
-- service_role get no rows even if a grant slips through (crm_secure_objects() from 001 revokes
-- them; it ran at the end of every migration so far and runs again here).

begin;

select public.crm_secure_objects();

do $$
declare
  n int;
begin
  select count(*) into n from pg_tables where schemaname = 'public' and tablename like 'crm\_%';
  if n <> 32 then
    raise exception 'Expected 32 crm_ tables, found %', n;
  end if;
  select count(*) into n from pg_tables where schemaname = 'public' and tablename like 'crm\_%' and not rowsecurity;
  if n <> 0 then
    raise exception '% crm_ tables without RLS', n;
  end if;
end $$;

commit;
