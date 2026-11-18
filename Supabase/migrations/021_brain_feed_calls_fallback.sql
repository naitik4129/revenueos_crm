-- 021_brain_feed_calls_fallback.sql
-- Resilience for brain_feed_calls when the voice platform's call-record write path is down.
--
-- brain_feed_calls (migration 018) reads the voice platform's `calls` / `call_transcripts` /
-- `campaign_contacts` tables. Those stopped being written around 2026-11-02/03, so the CRM lost all
-- call activity even though campaigns kept running. The full record (transcripts, recordings, precise
-- timings, sentiment) only exists on the voice platform and must be restored there. In the meantime,
-- the BRAIN still records per-call outcomes in brain_plan_tasks.result -> 'outcomes' (contact name,
-- company, status, outcome, duration, summary, QuickICP person id). This recreates brain_feed_calls as
-- the real rows UNION a fallback built from those brain-recorded outcomes.
--
-- Safe by construction:
--   * the fallback is emitted ONLY for a campaign that has NO rows in `calls`, so when the voice
--     platform writes real data the real rows win and there is no duplication;
--   * fallback rows get a deterministic synthetic id (md5 of campaign + person id), so CRM intake is
--     idempotent and stable across re-reads;
--   * columns are unchanged from 018, so the CRM consumer (brain-feed.service.ts) is unaffected.
-- Fallback rows carry null transcript/recording/sentiment/answered_at/ended_at — that data is not in
-- the brain. The CRM still records who was called, the outcome, duration and summary, and still acts
-- on interested / callback_requested / wrong_number / do_not_call outcomes.

begin;

drop view if exists public.brain_feed_calls;

create view public.brain_feed_calls as
-- Real call records from the voice platform (unchanged from migration 018) ------------------------
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
  ) tr on true

union all

-- Fallback from the brain's own recorded call outcomes, only for campaigns the voice platform has
-- not written any calls for -------------------------------------------------------------------------
select md5(k.campaign_id::text || ':' || coalesce(o.value ->> 'person_id', ''))::uuid as id,
       k.customer,
       k.campaign_id,
       pp.phone_number as phone,
       o.value ->> 'name' as contact_name,
       pp.email as contact_email,
       o.value ->> 'company' as contact_company,
       'outbound'::text as direction,
       o.value ->> 'status' as status,
       o.value ->> 'outcome' as outcome,
       (o.value ->> 'status' = 'completed') as connected,
       t.finished_at as started_at,
       null::timestamptz as answered_at,
       null::timestamptz as ended_at,
       case when o.value ->> 'duration_seconds' ~ '^[0-9]+$' then (o.value ->> 'duration_seconds')::int end as duration_seconds,
       o.value ->> 'summary' as summary,
       null::text as sentiment,
       null::jsonb as extracted_data,
       null::text as recording_url,
       null::text as transcript,
       t.finished_at as created_at,
       t.updated_at as updated_at
  from (
    select pt.id, pt.run_id, pt.task_id, pt.result, pt.finished_at, pt.updated_at
      from public.brain_plan_tasks pt
     where pt.output_type = 'calls'
       and jsonb_typeof(pt.result -> 'outcomes') = 'array'
  ) t
  join public.brain_customer_runs r on r.id = t.run_id
  join public.brain_feed_campaigns k
    on k.tool = 'quickhowl' and k.run_key = r.run_key and k.task_id = t.task_id and not k.test_mode
  cross join lateral jsonb_array_elements(t.result -> 'outcomes') as o(value)
  left join public.quickicp_revenueos_client_people_data pp
    on (o.value ->> 'person_id') ~ '^[0-9]+$' and pp.id = (o.value ->> 'person_id')::bigint
 where not exists (select 1 from public.calls c where c.campaign_id = k.campaign_id);

-- Access: crm_app reads; the Data API roles get nothing (as migration 018) ---------------------------
revoke all on public.brain_feed_calls from public, anon, authenticated, service_role;
grant select on public.brain_feed_calls to crm_app;

commit;
