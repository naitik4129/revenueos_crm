-- =============================================================================
-- Northbeam CRM -- lead nurturing status/disposition taxonomy (enum growth)
-- =============================================================================
--
-- Adds every new enum value needed for the richer call-disposition,
-- pipeline-stage, meeting-outcome and workflow-trigger taxonomy: granular
-- call outcomes (Interested - Later, Future Possibility, named objections),
-- the matching pipeline stages, three new meeting outcomes, and one
-- workflow trigger per new nurture sequence.
--
-- Deliberately additive only: this project has no live production data yet
-- (confirmed before writing this migration), so a destructive enum rewrite
-- was considered and rejected in favor of the cheaper, lower-risk option --
-- Postgres cannot cheaply DROP an enum value, and the old values here
-- ('maybe', 'negative', 'maybe_nurture', 'negative_nurture',
-- 'call_outcome_maybe', 'call_outcome_negative') are harmless left in place.
-- They are retired from the application layer instead (removed from the
-- TS union types / zod schemas / frontend option lists in the same change
-- that adds this migration), so they simply become unreachable rather than
-- requiring a risky ALTER TYPE ... rename-swap on indexed columns.
--
-- All statements below are pure additions (ALTER TYPE ... ADD VALUE) with no
-- new value used anywhere in this same file/transaction -- safe to batch
-- together, unlike 008_meeting_outcome_won.sql / 009_lead_created_trigger.sql
-- which each needed their own migration because the surrounding PR also
-- *used* the new value. See Supabase/migrations/012_lead_fields.sql for
-- where these values are first referenced (a separate, later migration).
-- =============================================================================

-- call_connected_outcome -- the Human Call Classification disposition list.
alter type public.call_connected_outcome add value 'interested_later';
alter type public.call_connected_outcome add value 'future_possibility';
alter type public.call_connected_outcome add value 'commission_only';
alter type public.call_connected_outcome add value 'internal_hiring';
alter type public.call_connected_outcome add value 'existing_team';
alter type public.call_connected_outcome add value 'budget_price';
alter type public.call_connected_outcome add value 'internal_approval';
alter type public.call_connected_outcome add value 'wrong_fit';

-- pipeline_stage -- the full CRM status architecture.
alter type public.pipeline_stage add value 'connected_qualifying';
alter type public.pipeline_stage add value 'interested_later';
alter type public.pipeline_stage add value 'future_possibility';
alter type public.pipeline_stage add value 'objection_nurture';
alter type public.pipeline_stage add value 'negotiation';

-- meeting_outcome -- post-meeting/demo nurture routing.
alter type public.meeting_outcome add value 'highly_interested';
alter type public.meeting_outcome add value 'needs_internal_discussion';
alter type public.meeting_outcome add value 'needs_more_information';

-- workflow_trigger -- one trigger per new nurture sequence introduced below.
alter type public.workflow_trigger add value 'call_outcome_interested_later';
alter type public.workflow_trigger add value 'call_outcome_future_possibility';
alter type public.workflow_trigger add value 'call_outcome_information_requested';
alter type public.workflow_trigger add value 'objection_commission_only';
alter type public.workflow_trigger add value 'objection_internal_hiring';
alter type public.workflow_trigger add value 'objection_existing_team';
alter type public.workflow_trigger add value 'objection_budget_price';
alter type public.workflow_trigger add value 'objection_internal_approval';
alter type public.workflow_trigger add value 'meeting_needs_more_information';
alter type public.workflow_trigger add value 'meeting_not_ready';
