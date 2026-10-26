-- 001_crm_schema.sql
-- The CRM lives in schema `public` with the prefix `crm_` (like the platform's revenueos_* and the
-- brain's brain_*): tables, enum types, functions, indexes and constraints are all named crm_*.
-- Requires 000_platform_grants.sql to have been run first.
--
-- `public` is exposed by the Supabase Data API, and Supabase grants every new table and function
-- there to anon, authenticated and service_role by default. crm_secure_objects() undoes that for
-- every crm_* object: no rights for those roles (service_role included: the platform and the brain
-- use its key, and it bypasses RLS), RLS on with no policies, and crm_app gets DML table by table
-- (a default privilege in public would also cover the platform's future tables). Every migration
-- that creates a crm_* table or function calls it at the end; it is safe to run again.

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_app') then
    raise exception 'Role crm_app does not exist. Run 000_platform_grants.sql first (needs platform approval).';
  end if;
end $$;

create function public.crm_secure_objects()
returns void
language plpgsql
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select c.relname, c.relkind
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname like 'crm\_%' and c.relkind in ('r', 'p', 'v', 'S')
  loop
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', r.relname);
    if r.relkind in ('r', 'p') then
      execute format('alter table public.%I enable row level security', r.relname);
      execute format('grant select, insert, update, delete on public.%I to crm_app', r.relname);
    elsif r.relkind = 'S' then
      execute format('grant usage, select on sequence public.%I to crm_app', r.relname);
    end if;
  end loop;

  -- Trigger functions fire without EXECUTE; nobody calls crm_* functions directly.
  for r in
    select p.oid::regprocedure as fn
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'crm\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.fn);
  end loop;
end;
$$;

select public.crm_secure_objects();

commit;
