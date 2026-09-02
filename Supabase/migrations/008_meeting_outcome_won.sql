-- =============================================================================
-- Northbeam CRM -- "Won" meeting outcome
-- =============================================================================

-- Adds 'won' to public.meeting_outcome so a meeting can be closed out with a
-- deal-won outcome directly, mirroring the existing proposal-accepted ->
-- lifecycle_state = 'won' path (see markWon in Backend/src/services/leads.service.ts).
--
-- ALTER TYPE ... ADD VALUE must run in its own migration/transaction --
-- Postgres does not allow a newly added enum value to be used in the same
-- transaction that added it (see the SECTION 2 comment in
-- 001_initial_migration.sql for the enum-growth convention this follows).
alter type public.meeting_outcome add value 'won';
