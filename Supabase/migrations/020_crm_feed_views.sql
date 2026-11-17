-- 020_crm_feed_views.sql
-- The reverse of brain_feed_* (018): read-only views public.crm_feed_* that expose the CRM's own
-- working progress (what humans and the CRM did to a lead) BACK to the brain. Today data flows one
-- way (brain -> CRM via brain_feed_*), and the only thing the brain reads back is the suppression
-- list (negatives: unsubscribe / bounce / do-not-contact). These views close that gap for the
-- positive / in-progress side, so the brain can stop re-contacting a lead a human already handled
-- and credit that work toward its targets.
--
-- How the brain reads them: through the Supabase Data API with the service_role key
-- (brain/supabase_store.py uses create_client + db.table(name).select(...).eq("customer", ...)),
-- exactly as it reads its own tables. So, unlike 018 (which is read by the CRM worker as crm_app and
-- therefore revokes service_role), these are granted to service_role and nobody else.
--
-- Scope / privacy: ONLY contacts (and their deals) that carry a brain external id are exposed. Those
-- are the only rows the brain can match to a record it knows, and it already knows them -- a purely
-- manual CRM contact the brain never created is never revealed. Every row carries the brain
-- `customer` key (revenueos_projects.brain_customer_key, via the workspace's platform project) and an
-- `updated_at`, so the brain pages by (updated_at, id) bookmarks the same way the CRM pages brain_feed_*.
--
-- Security: crm_contacts / crm_deals / crm_external_refs have RLS enabled but NOT forced and are owned
-- by postgres, so these postgres-owned views (default owner's-rights execution) read every row, the
-- same way 018's views do. No table grant on crm_* is needed.
--
-- This is additive and read-only: it creates no tables, changes no rows, and can be dropped with no
-- effect on the CRM.

begin;

-- Contacts the brain knows, with their current lifecycle and status --------------------------------
-- lifecycle_stage: prospect | contacted | engaged | qualified | customer  (forward progress)
-- status:          active | do_not_contact | merged                        (do_not_contact already
--                                                                           reaches the brain via the
--                                                                           suppression feed; it is
--                                                                           repeated here for context)
create view public.crm_feed_contacts as
select c.id,
       p.brain_customer_key as customer,
       c.lifecycle_stage,
       c.status,
       c.owner_id,
       (select coalesce(
                 json_agg(json_build_object('source', r.source, 'externalId', r.external_id)
                          order by r.source, r.external_id),
                 '[]'::json)
          from public.crm_external_refs r
         where r.contact_id = c.id) as external_ids,
       c.last_activity_at,
       c.created_at,
       c.updated_at
  from public.crm_contacts c
  join public.crm_workspaces w on w.id = c.workspace_id and w.is_active
  join public.revenueos_projects p on p.id = w.platform_project_id
                                  and p.brain_customer_key is not null
                                  and length(trim(p.brain_customer_key)) > 0
 where exists (select 1 from public.crm_external_refs r where r.contact_id = c.id);

-- Deals the brain's contacts are in: an open or won deal means a human is working that lead ---------
-- stage:   the CRM pipeline (new .. negotiation)
-- outcome: open | won | lost | nurture | discarded
-- external_source / external_id: the deal's own brain ref when it was created from a handover
-- (e.g. quickhowl 'call:<id>'); contact_external_ids carries the deal's contact's refs for matching.
create view public.crm_feed_deals as
select d.id,
       p.brain_customer_key as customer,
       d.contact_id,
       d.stage,
       d.outcome,
       d.amount,
       d.currency,
       d.owner_id,
       d.service_interest,
       d.external_source,
       d.external_id,
       (select coalesce(
                 json_agg(json_build_object('source', r.source, 'externalId', r.external_id)
                          order by r.source, r.external_id),
                 '[]'::json)
          from public.crm_external_refs r
         where r.contact_id = d.contact_id) as contact_external_ids,
       d.closed_at,
       d.last_activity_at,
       d.created_at,
       d.updated_at
  from public.crm_deals d
  join public.crm_workspaces w on w.id = d.workspace_id and w.is_active
  join public.revenueos_projects p on p.id = w.platform_project_id
                                  and p.brain_customer_key is not null
                                  and length(trim(p.brain_customer_key)) > 0
 where exists (select 1 from public.crm_external_refs r where r.contact_id = d.contact_id);

-- Access: the brain reads via the Data API (service_role); nobody else -----------------------------
-- (Supabase grants new public views to the Data API roles by default, so the revoke is what keeps
-- anon / authenticated / crm_app out; service_role is then granted back explicitly.)
do $$
declare
  v text;
begin
  foreach v in array array['crm_feed_contacts', 'crm_feed_deals'] loop
    execute format('revoke all on public.%I from public, anon, authenticated, crm_app', v);
    execute format('grant select on public.%I to service_role', v);
  end loop;
end $$;

commit;
