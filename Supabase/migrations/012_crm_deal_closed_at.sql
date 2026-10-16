-- 012_crm_deal_closed_at.sql
-- deals.closed_at: when the deal last left 'open' (won/lost/discarded/nurture). Cleared on
-- reopen. Set by trigger so every code path (API, brain, worker) stays consistent.
-- The dashboard counts won/lost "this month" by it.

begin;

alter table crm.deals add column closed_at timestamptz;

-- Fresh start, but keep any existing non-open deal consistent.
update crm.deals set closed_at = updated_at where outcome <> 'open';

create function crm.deals_set_closed_at()
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

create trigger deals_set_closed_at
  before insert or update of outcome on crm.deals
  for each row execute function crm.deals_set_closed_at();

create index deals_workspace_closed_at_idx on crm.deals (workspace_id, closed_at) where closed_at is not null;

commit;
