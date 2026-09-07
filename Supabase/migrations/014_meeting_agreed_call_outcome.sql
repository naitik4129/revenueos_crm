-- =============================================================================
-- Northbeam CRM -- Meeting Agreed call outcome and workflow trigger
-- =============================================================================
--
-- Adds a dedicated connected-call outcome for cases where the rep has agreed
-- a meeting with the lead, plus the matching workflow trigger so managers can
-- build a specific Meeting Agreed workflow in Automations.
--
-- Additive enum growth only. The new values are used by application code after
-- this migration has committed.

alter type public.call_connected_outcome add value 'meeting_agreed';
alter type public.workflow_trigger add value 'meeting_agreed';
