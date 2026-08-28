-- =============================================================================
-- Northbeam CRM — bug-fix migration (follow-up audit, see PR/commit history
-- for the full report this addresses).
--
-- Scope, deliberately: only fixes that are safe to run against a live
-- database with existing data. Two findings from the same audit are NOT
-- included here on purpose:
--   - UNIQUE constraints on leads.email / leads.phone / profiles.email would
--     fail outright if any duplicates already exist in production data —
--     adding these safely requires a dedup pass first, run separately.
--   - Requiring tasks.source_workflow_step_id whenever origin = 'automation'
--     would conflict with that column's existing
--     "references workflow_steps(id) on delete set null" — a task can
--     legitimately end up with a null step id today if its originating step
--     is later deleted, so a NOT NULL-style CHECK here would fight the
--     schema's own designed behavior rather than fix a bug.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Fix 1 — cascade_lead_lifecycle_change: reactivating a DNC lead never
-- cleared leads.dnc_reason, so it permanently displayed the *reactivation*
-- explanation instead of "why this lead is suppressed" (its documented
-- purpose) on an active, contactable lead. Recreated as a BEFORE trigger
-- (was AFTER) so it can null out new.dnc_reason once the transition is
-- recorded in dnc_events — an AFTER trigger's NEW is not written back, so
-- clearing it there would have required a recursive self-UPDATE instead.
-- Every other branch of the function is unchanged; none of them depend on
-- the leads row already being committed.
-- -----------------------------------------------------------------------------

create or replace function public.cascade_lead_lifecycle_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_lifecycle public.lead_lifecycle_state;
  v_reason text;
begin
  if tg_op = 'INSERT' then
    v_old_lifecycle := null;
  else
    v_old_lifecycle := old.lifecycle_state;
  end if;

  -- Entering a terminal state: invalidate whatever automation was still
  -- pending for this lead instead of letting it fire later.
  if new.lifecycle_state in ('won', 'lost', 'discarded', 'do_not_contact', 'merged')
     and v_old_lifecycle is distinct from new.lifecycle_state then
    v_reason := 'Lead lifecycle changed to ' || new.lifecycle_state;

    update public.workflow_runs
    set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason
    where lead_id = new.id
      and status in ('running', 'waiting', 'paused');

    update public.scheduled_actions
    set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason
    where lead_id = new.id
      and status in ('pending', 'due', 'paused');
  end if;

  -- Entering Do Not Contact: record the suppression permanently.
  if new.lifecycle_state = 'do_not_contact'
     and v_old_lifecycle is distinct from 'do_not_contact' then
    insert into public.dnc_events (lead_id, action, reason, actor_id, actor_name)
    values (new.id, 'suppressed', new.dnc_reason, new.dnc_by, new.dnc_by_name);
  end if;

  -- Leaving Do Not Contact: this must be an explicit, reasoned action, not
  -- an incidental side effect of some other bulk update — require a reason
  -- to be present on the row being written, and record the reactivation
  -- permanently. dnc_events already preserves the original suppression
  -- record from above, so reactivating never erases that history.
  if v_old_lifecycle = 'do_not_contact' and new.lifecycle_state <> 'do_not_contact' then
    if new.dnc_reason is null then
      raise exception 'Reactivating a Do Not Contact lead requires dnc_reason to explain why.'
        using errcode = '23514';
    end if;

    insert into public.dnc_events (lead_id, action, reason, actor_id, actor_name)
    values (new.id, 'reactivated', new.dnc_reason, new.dnc_by, new.dnc_by_name);

    -- Fix: previously left in place forever, so an active/contactable lead's
    -- "DNC reason" field kept showing why it was un-suppressed rather than
    -- why (or whether) it had been suppressed. dnc_events above is the
    -- permanent record of both the original suppression and this
    -- reactivation, so clearing the working column here loses no history.
    new.dnc_reason := null;
  end if;

  return new;
end;
$$;

drop trigger if exists leads_cascade_lifecycle_change on public.leads;

create trigger leads_cascade_lifecycle_change
  before insert or update on public.leads
  for each row
  execute function public.cascade_lead_lifecycle_change();


-- -----------------------------------------------------------------------------
-- Fix 2 — a workflow_run/scheduled_action could be marked 'failed' with a
-- null last_error, leaving on-call staff nothing to act on. Matches the
-- existing "<status>_matches_status" CHECK convention already used on these
-- same two tables (see workflow_runs_completed_at_matches_status etc.).
-- -----------------------------------------------------------------------------

alter table public.workflow_runs
  add constraint workflow_runs_failed_has_error
  check (status <> 'failed' or last_error is not null);

alter table public.scheduled_actions
  add constraint scheduled_actions_failed_has_error
  check (status <> 'failed' or last_error is not null);


-- -----------------------------------------------------------------------------
-- Fix 3 — missing indexes on FK/lookup columns that had none. Harmless to
-- add on tables with little or no existing data (these are all new
-- automation-era tables); prevents seq-scans as they grow.
-- -----------------------------------------------------------------------------

create index if not exists workflow_steps_template_id_idx
  on public.workflow_steps (template_id)
  where template_id is not null;

create index if not exists tasks_source_workflow_step_id_idx
  on public.tasks (source_workflow_step_id)
  where source_workflow_step_id is not null;

create index if not exists timeline_events_related_task_id_idx
  on public.timeline_events (related_task_id)
  where related_task_id is not null;

create index if not exists timeline_events_related_meeting_id_idx
  on public.timeline_events (related_meeting_id)
  where related_meeting_id is not null;

create index if not exists timeline_events_related_proposal_id_idx
  on public.timeline_events (related_proposal_id)
  where related_proposal_id is not null;

create index if not exists timeline_events_related_call_id_idx
  on public.timeline_events (related_call_id)
  where related_call_id is not null;

create index if not exists notifications_lead_id_idx
  on public.notifications (lead_id)
  where lead_id is not null;
