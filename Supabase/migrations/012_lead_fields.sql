-- =============================================================================
-- Northbeam CRM -- leads: objection type, Interested-Later capture, loss reason
-- =============================================================================
--
-- New nullable columns on public.leads: the call-disposition objection_type,
-- the "Interested - Later" capture fields (reason for delay / future timing /
-- next planned action / decision owner), and the loss reason. Safe to
-- reference the enum values added in 010_status_enums.sql here -- that
-- migration already committed in its own transaction before this one runs.

alter table public.leads add column objection_type public.objection_type;

comment on column public.leads.objection_type is
  'Set alongside pipeline_stage = objection_nurture (see leads_objection_stage_has_type). '
  'Also set (without moving the lead into objection_nurture) for wrong_fit, purely for reporting '
  '-- see Backend/src/domain/callRouting.ts routeConnectedOutcome("wrong_fit").';

-- Interested - Later capture -- deliberately free text / a date, not a
-- closed enum: these are illustrative examples ("Budget cycle, product
-- launch, existing vendor contract, internal hiring, management approval,
-- new financial year"), not an exhaustive list.
alter table public.leads add column interested_later_reason text;
alter table public.leads add column interested_later_restart_at date;
alter table public.leads add column interested_later_next_action text;
alter table public.leads add column interested_later_decision_owner text;

comment on column public.leads.interested_later_restart_at is
  'Expected month/date the customer indicated as when this may become relevant again. Drives the '
  'reconnect-task due date (restart date minus ~7 days) -- see routeConnectedOutcome("interested_later").';

alter table public.leads add column loss_reason public.lead_loss_reason;
alter table public.leads add column loss_notes text;

-- Mirrors the existing leads_dnc_has_reason constraint pattern exactly:
-- entering a terminal disposition requires the reason to already be present
-- on the row being written, at the database level, not just app-level.
alter table public.leads
  add constraint leads_lost_has_reason
  check (lifecycle_state <> 'lost' or loss_reason is not null);

-- Mirrors the same pattern for Objection Nurture: the pipeline_stage and its
-- sub-reason must always travel together.
alter table public.leads
  add constraint leads_objection_stage_has_type
  check (pipeline_stage <> 'objection_nurture' or objection_type is not null);

create index leads_objection_type_idx on public.leads (objection_type) where objection_type is not null;
create index leads_loss_reason_idx on public.leads (loss_reason) where loss_reason is not null;
create index leads_interested_later_restart_idx on public.leads (interested_later_restart_at)
  where interested_later_restart_at is not null;
