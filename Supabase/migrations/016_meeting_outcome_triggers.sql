-- =============================================================================
-- Northbeam CRM -- dedicated workflow triggers for meeting outcomes
-- =============================================================================
--
-- Three meeting outcomes (Highly Interested, Proposal Requested, Not a Fit)
-- previously had no matching workflow_trigger value at all, so no automation
-- could ever be built or fired off them -- meetingRouting.ts simply never set
-- a workflowTrigger for those cases. This adds one dedicated trigger per
-- outcome so each is selectable in the Automation builder and so
-- recordMeetingOutcome's existing autoEnroll call (meetings.service.ts) can
-- actually enroll a matching workflow when a rep records one of these
-- outcomes.
--
-- `needs_internal_discussion` deliberately gets no new trigger here -- it
-- continues to reuse `objection_internal_approval`, unchanged.
--
-- Pure additions (ALTER TYPE ... ADD VALUE), no new value referenced in this
-- same file/transaction -- safe to batch together, matching the pattern in
-- 010_status_enums.sql.
-- =============================================================================

alter type public.workflow_trigger add value 'meeting_highly_interested';
alter type public.workflow_trigger add value 'meeting_proposal_requested';
alter type public.workflow_trigger add value 'meeting_not_a_fit';
