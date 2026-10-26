-- 018_brain_feed_views.sql
-- The contract between the brain (QuickICP, Quickhowl, Email Tool) and the CRM: read-only views
-- public.brain_feed_*. The CRM worker reads ONLY these views, never the tables behind them, so the
-- brain, Quickhowl and the Email Tool may change their own tables as long as these columns stay.
-- Every row carries the brain `customer` key (= revenueos_projects.brain_customer_key) and an
-- `updated_at` the CRM pages by ((updated_at, id) bookmarks).
--
-- Access: crm_app may SELECT; anon, authenticated and service_role get nothing. The views run with
-- their owner's rights (postgres), so crm_app needs no right on the tables behind them; that is why
-- the revoke below matters (Supabase grants new views in public to the Data API roles by default).
--
-- Calls and emails come only from campaigns the brain launched (found through brain_tool_calls),
-- and never from a test run (brain_customer_runs.test_mode): test calls go to the brain's own numbers.

begin;

-- Which Quickhowl / Email Tool campaign belongs to which customer run ---------------------------
create view public.brain_feed_campaigns as
select distinct on (x.tool, x.campaign_id)
       x.tool,                       -- 'quickhowl' | 'email_tool'
       x.campaign_id,                -- voice_campaigns.id | campaigns.id
       r.customer,
       r.run_key,
       r.test_mode,
       p.task_id,
       x.started_at as launched_at
  from (
    select t.task_row_id, t.tool, t.started_at,
           (case when t.tool = 'quickhowl' then t.response -> 'campaign' ->> 'id'
                 else t.response ->> 'campaign_id' end) as campaign_text
      from public.brain_tool_calls t
     where t.status = 'done'
       and ((t.tool = 'quickhowl' and t.step in ('store', 'start'))
         or (t.tool = 'email_tool' and t.step in ('launch', 'approve')))
  ) raw
  cross join lateral (
    select raw.tool, raw.started_at, raw.task_row_id,
           case when raw.campaign_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then raw.campaign_text::uuid end as campaign_id
  ) x
  join public.brain_plan_tasks p on p.id = x.task_row_id
  join public.brain_customer_runs r on r.id = p.run_id
 where x.campaign_id is not null
 order by x.tool, x.campaign_id, x.started_at;

-- QuickICP companies ---------------------------------------------------------------------------
create view public.brain_feed_companies as
select c.id, c.customer, c.company_name as name, c.website, c.industry, c.location, c.headcount,
       c.phone, c.linkedin as linkedin_url, c.created_at, c.updated_at
  from public.quickicp_revenueos_client_company_data c;

-- QuickICP people ------------------------------------------------------------------------------
create view public.brain_feed_people as
select p.id, p.customer, p.company_id, p.full_name, p.job_position as job_title, p.email,
       p.phone_number as phone, p.user_social as linkedin_url, p.country, p.location,
       p.created_at, p.updated_at
  from public.quickicp_revenueos_client_people_data p;

-- Quickhowl AI calls (brain campaigns, no test runs) ---------------------------------------------
-- outcome: interested | not_interested | callback_requested | wrong_number | do_not_call |
-- voicemail | pending | no_answer | call_dropped. The CRM skips 'pending' until it changes.
create view public.brain_feed_calls as
select c.id, k.customer, c.campaign_id, c.phone_number as phone, cc.name as contact_name,
       cc.email as contact_email, cc.company as contact_company, c.direction, c.status, c.outcome,
       (c.answered_at is not null) as connected, c.started_at, c.answered_at, c.ended_at,
       c.duration_seconds, c.summary, c.sentiment, c.extracted_data, c.recording_url,
       tr.full_text as transcript, c.created_at,
       greatest(c.updated_at, tr.created_at) as updated_at
  from public.calls c
  join public.brain_feed_campaigns k on k.tool = 'quickhowl' and k.campaign_id = c.campaign_id and not k.test_mode
  left join public.campaign_contacts cc on cc.id = c.contact_id
  left join lateral (
    select t.full_text, t.created_at from public.call_transcripts t
     where t.call_id = c.id order by t.created_at desc limit 1
  ) tr on true;

-- Email Tool campaign emails actually sent, with their opens and bounces ------------------------------
create view public.brain_feed_emails as
select m.id, k.customer, m.campaign_id, cp.name as campaign_name, s.position as step,
       m.content_subject as subject, m.frozen_destination as to_email, m.enrollment_id,
       m.accepted_at as sent_at,
       ev.opened_at, ev.bounced_at, ev.bounce_type,
       m.created_at,
       greatest(m.updated_at, ev.last_event_at) as updated_at
  from public.messages m
  join public.brain_feed_campaigns k on k.tool = 'email_tool' and k.campaign_id = m.campaign_id and not k.test_mode
  left join public.campaigns cp on cp.workspace_id = m.workspace_id and cp.id = m.campaign_id
  left join public.sequence_steps s on s.workspace_id = m.workspace_id and s.sequence_id = m.sequence_id and s.id = m.step_id
  left join lateral (
    select min(e.first_occurred_at) filter (where e.kind = 'OPENED') as opened_at,
           min(e.first_occurred_at) filter (where e.kind = 'BOUNCED') as bounced_at,
           min(e.bounce_type) filter (where e.kind = 'BOUNCED') as bounce_type,
           max(greatest(e.last_occurred_at, e.created_at)) as last_event_at
      from public.message_events e
     where e.workspace_id = m.workspace_id and e.message_id = m.id
  ) ev on true
 where m.purpose = 'CAMPAIGN' and m.status = 'SENT';

-- Email Tool outcomes per recipient of a campaign: replied, unsubscribed, hard bounce, complaint -------
create view public.brain_feed_email_outcomes as
select o.id, k.customer, en.campaign_id, o.enrollment_id, o.kind, o.occurred_at,
       ra.canonical_address as email, im.subject as reply_subject, im.content_text as reply_text,
       o.created_at, o.created_at as updated_at
  from public.recipient_outcomes o
  join public.campaign_enrollments en on en.workspace_id = o.workspace_id and en.id = o.enrollment_id
  join public.brain_feed_campaigns k on k.tool = 'email_tool' and k.campaign_id = en.campaign_id and not k.test_mode
  left join public.recipient_addresses ra on ra.workspace_id = en.workspace_id and ra.id = en.address_id
  left join public.inbound_messages im on im.workspace_id = o.workspace_id and im.id = o.inbound_message_id;

-- Access: crm_app reads; the Data API roles get nothing ---------------------------------------------
do $$
declare
  v text;
begin
  foreach v in array array['brain_feed_campaigns', 'brain_feed_companies', 'brain_feed_people',
                           'brain_feed_calls', 'brain_feed_emails', 'brain_feed_email_outcomes'] loop
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', v);
    execute format('grant select on public.%I to crm_app', v);
  end loop;
end $$;

commit;
