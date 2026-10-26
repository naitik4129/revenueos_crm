-- 009_crm_triggers.sql
-- 1. updated_at on every crm table that has the column.
-- 2. Contact status change: DNC history + consent stop (automation off, runs/actions cancelled).
-- 3. Deal automation guard: automation only on 'open' or 'nurture' deals of an active contact.
-- 4. Deal outcome cascade: cancel runs/actions on any outcome change; open tasks on won/lost/discarded.
-- 5. Task contact must match its deal's contact when both are set.
-- Functions run as the caller (crm_app), which has DML on all crm tables.

begin;

-- 1. updated_at ------------------------------------------------------------

create function public.crm_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  for t in
    select table_name from information_schema.columns
    where table_schema = 'public' and table_name like 'crm\_%' and column_name = 'updated_at'
    order by table_name
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.crm_set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end $$;

-- 2. Contact status: DNC history + consent stop ----------------------------
-- BEFORE UPDATE only: contacts are created 'active'. DNC and reactivation both carry their
-- reason/actor in dnc_reason/dnc_by/dnc_by_name on the same update.

create function public.crm_contacts_status_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_reason text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'do_not_contact' then
    new.dnc_at := coalesce(new.dnc_at, now());
    insert into public.crm_dnc_events (contact_id, action, reason, actor_id, actor_name)
    values (new.id, 'suppressed', new.dnc_reason, new.dnc_by, new.dnc_by_name);
  elsif old.status = 'do_not_contact' and new.status = 'active' then
    if new.dnc_reason is null then
      raise exception 'Reactivating a Do Not Contact contact requires dnc_reason to explain why.'
        using errcode = '23514';
    end if;
    insert into public.crm_dnc_events (contact_id, action, reason, actor_id, actor_name)
    values (new.id, 'reactivated', new.dnc_reason, new.dnc_by, new.dnc_by_name);
    new.dnc_reason := null;
    new.dnc_by := null;
    new.dnc_by_name := null;
    new.dnc_at := null;
  end if;

  -- DNC keeps deals open but stops all their automation. Merge does the same for whatever
  -- deals are still on the merged contact.
  if new.status in ('do_not_contact', 'merged') then
    v_reason := 'Contact status changed to ' || new.status;

    update public.crm_deals
    set automation_mode = 'stopped'
    where contact_id = new.id and automation_mode <> 'stopped';

    update public.crm_workflow_runs
    set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason
    where contact_id = new.id and status in ('running', 'waiting', 'paused');

    update public.crm_scheduled_actions
    set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason
    where status in ('pending', 'due', 'paused')
      and workflow_run_id in (select id from public.crm_workflow_runs where contact_id = new.id);
  end if;

  return new;
end;
$$;

create trigger crm_contacts_status_change
  before update of status on public.crm_contacts
  for each row execute function public.crm_contacts_status_change();

-- 3. Deal automation guard -------------------------------------------------
-- 'nurture' is allowed: meeting_not_a_fit moves the deal to nurture, then enrolls a nurture
-- workflow. Anything else not open, or a contact that is not active, forces 'stopped'.

create function public.crm_deals_enforce_automation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.automation_mode <> 'stopped'
     and (
       new.outcome not in ('open', 'nurture')
       or exists (select 1 from public.crm_contacts c where c.id = new.contact_id and c.status <> 'active')
     ) then
    new.automation_mode := 'stopped';
  end if;
  return new;
end;
$$;

create trigger crm_deals_enforce_automation
  before insert or update on public.crm_deals
  for each row execute function public.crm_deals_enforce_automation();

-- 4. Deal outcome cascade --------------------------------------------------
-- Any outcome change cancels the deal's in-flight runs/actions (e.g. open -> nurture cancels
-- the old runs; the backend enrolls the nurture workflow afterwards). Closing the deal also
-- cancels its open tasks.

create function public.crm_deals_outcome_cascade()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_reason text;
begin
  if new.outcome is not distinct from old.outcome then
    return null;
  end if;

  v_reason := 'Deal outcome changed to ' || new.outcome;

  update public.crm_workflow_runs
  set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason
  where deal_id = new.id and status in ('running', 'waiting', 'paused');

  update public.crm_scheduled_actions
  set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason
  where deal_id = new.id and status in ('pending', 'due', 'paused');

  if new.outcome in ('won', 'lost', 'discarded') then
    update public.crm_tasks
    set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason
    where deal_id = new.id and status = 'open';
  end if;

  return null;
end;
$$;

create trigger crm_deals_outcome_cascade
  after update of outcome on public.crm_deals
  for each row execute function public.crm_deals_outcome_cascade();

-- 5. Task contact = deal contact --------------------------------------------

create function public.crm_tasks_contact_matches_deal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.deal_id is not null and new.contact_id is not null
     and not exists (select 1 from public.crm_deals d where d.id = new.deal_id and d.contact_id = new.contact_id) then
    raise exception 'Task contact_id must equal its deal''s contact_id.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger crm_tasks_contact_matches_deal
  before insert or update of deal_id, contact_id on public.crm_tasks
  for each row execute function public.crm_tasks_contact_matches_deal();

-- Locks down the new crm_* objects (see 001).
select public.crm_secure_objects();

commit;
