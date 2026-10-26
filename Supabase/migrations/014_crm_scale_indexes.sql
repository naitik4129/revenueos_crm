-- 014_crm_scale_indexes.sql
-- Scale pass (CLAUDE.md "Scale + sending safety pass", items 6, 7, 10). Indexes only; no data changes.
-- Safe to run before or after 014a.

begin;

-- Item 6: dashboard counts per workspace and time window (calls and campaign emails this week).
create index crm_calls_workspace_occurred_at_idx on public.crm_calls (workspace_id, occurred_at);
create index crm_email_activities_workspace_sent_at_idx on public.crm_email_activities (workspace_id, sent_at);
create index crm_email_activities_workspace_replied_at_idx on public.crm_email_activities (workspace_id, replied_at) where replied_at is not null;

-- Item 7: the contacts and deals lists' default and "last activity" / "created" sorts, one page at a time.
create index crm_contacts_workspace_created_at_idx on public.crm_contacts (workspace_id, created_at desc);
create index crm_contacts_workspace_last_activity_idx on public.crm_contacts (workspace_id, last_activity_at desc);
create index crm_deals_workspace_created_at_idx on public.crm_deals (workspace_id, created_at desc);
create index crm_deals_workspace_last_activity_idx on public.crm_deals (workspace_id, last_activity_at desc);

-- Item 10: the worker's claim of actions stuck in `executing` (crm_scheduled_actions_due_idx covers pending/due).
create index crm_scheduled_actions_executing_idx on public.crm_scheduled_actions (last_attempt_at) where status = 'executing';

commit;
