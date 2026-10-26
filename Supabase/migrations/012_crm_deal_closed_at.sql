-- 012_crm_deal_closed_at.sql
-- deals.closed_at: when the deal last left 'open' (won/lost/discarded/nurture). Cleared on
-- reopen. Set by trigger so every code path (API, brain, worker) stays consistent.
-- The dashboard counts won/lost "this month" by it.

begin;

alter table public.crm_deals add column closed_at timestamptz;

-- Fresh start, but keep any existing non-open deal consistent.
update public.crm_deals set closed_at = updated_at where outcome <> 'open';

create function public.crm_deals_set_closed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.closed_at := case when new.outcome = 'open' then null else coalesce(new.closed_at, now()) end;
  elsif new.outcome is distinct from old.outcome then
    new.closed_at := case when new.outcome = 'open' then null else now() end;
  end if;
  return new;
end;
$$;

create trigger crm_deals_set_closed_at
  before insert or update of outcome on public.crm_deals
  for each row execute function public.crm_deals_set_closed_at();

create index crm_deals_workspace_closed_at_idx on public.crm_deals (workspace_id, closed_at) where closed_at is not null;

-- Locks down the new crm_* objects (see 001).
select public.crm_secure_objects();

commit;
