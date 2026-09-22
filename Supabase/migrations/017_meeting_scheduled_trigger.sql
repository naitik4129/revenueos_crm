-- =============================================================================
-- Northbeam CRM -- dedicated workflow trigger for meeting scheduled
-- =============================================================================
--
-- Booking a meeting had no matching workflow_trigger value, so no automation
-- could ever fire off it -- scheduleMeeting (meetings.service.ts) simply never
-- called autoEnroll. This adds a dedicated trigger so "Meeting Scheduled" is
-- selectable in the Automation builder and scheduleMeeting's new autoEnroll
-- call can actually enroll a matching workflow when a meeting is booked.
--
-- Pure addition (ALTER TYPE ... ADD VALUE), no new value referenced in this
-- same file/transaction -- safe, matching the pattern in
-- 016_meeting_outcome_triggers.sql.
-- =============================================================================

alter type public.workflow_trigger add value 'meeting_scheduled';
