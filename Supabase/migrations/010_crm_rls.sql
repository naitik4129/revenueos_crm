-- 010_crm_rls.sql
-- Enable RLS on every crm table with NO policies, and strip any rights from the Data API roles.
--
-- The backend still reads and writes everything: it connects as crm_app, created with
-- BYPASSRLS in 000_platform_grants.sql, so RLS does not apply to it. anon/authenticated get
-- no rows even if a grant slips through. Also keep `crm` OUT of the exposed schemas in
-- Supabase Dashboard -> API settings (that is a dashboard setting, not SQL).

begin;

do $$
declare
  t text;
  n int := 0;
begin
  for t in select tablename from pg_tables where schemaname = 'crm' order by tablename loop
    execute format('alter table crm.%I enable row level security', t);
    n := n + 1;
  end loop;

  if n <> 32 then
    raise exception 'Expected 32 crm tables, found %', n;
  end if;
end $$;

revoke all on all tables in schema crm from public, anon, authenticated;
revoke all on all sequences in schema crm from public, anon, authenticated;
revoke all on all functions in schema crm from public, anon, authenticated;

commit;
