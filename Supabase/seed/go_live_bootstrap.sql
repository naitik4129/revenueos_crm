-- go_live_bootstrap.sql
-- Starter data for the CRM (CLAUDE.md "Go-live users"): run once in the Supabase SQL Editor of
-- RevenueOSDatabase. Safe to run again (nothing is duplicated). Writes only crm_* rows.
--
--  1. CRM access for revenueosplatform@gmail.com as ADMIN (an existing RevenueOS account; the CRM
--     never creates accounts). It logs in with its normal RevenueOS email and password.
--  2. One workspace per active project with brain data, linked by platform_project_id, so the
--     brain feed reader copies that project's data into it.
-- Salespeople are added later from the CRM (Admin > Users, then Admin > Members).

begin;

-- 1. Admin
insert into public.crm_profiles (id, role)
select p.id, 'admin'
  from public.revenueos_profiles p
 where lower(p.email) = 'revenueosplatform@gmail.com'
on conflict (id) do update set role = 'admin', is_active = true;

do $$
begin
  if not exists (
    select 1 from public.crm_profiles cp join public.revenueos_profiles p on p.id = cp.id
     where lower(p.email) = 'revenueosplatform@gmail.com' and cp.role = 'admin' and cp.is_active
  ) then
    raise exception 'No RevenueOS account revenueosplatform@gmail.com: nothing was changed.';
  end if;
end $$;

-- 2. Workspaces (name = the project's customer name, slug = its brain key)
insert into public.crm_workspaces (name, slug, platform_project_id, created_by)
select pr.customer_name, pr.brain_customer_key, pr.id,
       (select p.id from public.revenueos_profiles p where lower(p.email) = 'revenueosplatform@gmail.com')
  from public.revenueos_projects pr
 where pr.brain_customer_key in ('anvixa-ai-product', 'durel-company-d6f620', 'anvixa-ai-version2-e3555f')
   and pr.archived_at is null
on conflict do nothing;

-- What is there now
select w.name, w.slug, pr.brain_customer_key, w.platform_project_id
  from public.crm_workspaces w join public.revenueos_projects pr on pr.id = w.platform_project_id
 order by w.name;

commit;
