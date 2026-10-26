-- 019_crm_brain_feed_cursors.sql
-- Bookmarks of the brain feed reader (brain-feed.service.ts): per workspace and brain_feed_* view,
-- the (updated_at, id) of the last row taken, so each run reads only what changed since. The id is
-- text because the views' ids are bigint (QuickICP) or uuid (Quickhowl, Email Tool). Deleting a
-- row makes the next run read that view again from the start (safe: every item is idempotent).

begin;

create table public.crm_brain_feed_cursors (
  workspace_id uuid not null references public.crm_workspaces (id) on delete cascade,
  feed text not null,
  last_updated_at timestamptz,
  last_id text,
  rows_read bigint not null default 0,
  rows_failed bigint not null default 0,
  last_run_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, feed),
  constraint crm_brain_feed_cursors_feed_valid check (feed in ('companies', 'people', 'calls', 'emails', 'email_outcomes')),
  constraint crm_brain_feed_cursors_position_pair check ((last_updated_at is null) = (last_id is null))
);

create trigger crm_brain_feed_cursors_set_updated_at before update on public.crm_brain_feed_cursors
  for each row execute function public.crm_set_updated_at();

-- Locks down the new crm_* objects (see 001).
select public.crm_secure_objects();

commit;
