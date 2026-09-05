-- =============================================================================
-- Northbeam CRM -- objection and loss-reason vocabularies
-- =============================================================================
--
-- Two new, freshly created enum types (not ALTER TYPE ADD VALUE, so no
-- same-transaction-use restriction applies -- these can be referenced by a
-- later migration in this same deploy, unlike 010_status_enums.sql's
-- additions).
--
-- objection_type mirrors the 6 objection dispositions used across call and
-- meeting outcomes ("Wrong Fit" plus the 5 objection-nurture tracks).
-- Consumed by leads.objection_type, added in 012_lead_fields.sql.
create type public.objection_type as enum (
  'commission_only',
  'internal_hiring',
  'existing_team',
  'budget_price',
  'internal_approval',
  'wrong_fit'
);

comment on type public.objection_type is
  'The specific objection/reason a lead is in Objection Nurture (pipeline_stage = objection_nurture).';

-- lead_loss_reason is the shared loss-reason vocabulary for a lost lead or a
-- rejected/expired proposal. Shared by leads.loss_reason (set when
-- lifecycle_state = 'lost') and proposals.loss_reason (set on rejected /
-- expired, which does not by itself move the lead to Lost -- see
-- 013_proposal_loss_fields.sql).
create type public.lead_loss_reason as enum (
  'price_budget',
  'internal_hiring',
  'project_postponed',
  'competitor_selected',
  'management_rejected',
  'no_urgency',
  'no_response',
  'other'
);

comment on type public.lead_loss_reason is
  'Why a lead or proposal was lost. Drives which reactivation approach/content applies later -- '
  'see the reactivation_* disposable workflow seeds.';
