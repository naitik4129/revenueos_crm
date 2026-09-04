-- =============================================================================
-- Northbeam CRM -- "Lead Created" workflow trigger
-- =============================================================================

-- Adds 'lead_created' to public.workflow_trigger so a workflow can
-- auto-enroll a lead the instant it enters the CRM (Stage 1 of the MOTM
-- nurture funnel: welcome email + WhatsApp message, sent in parallel with
-- the human BD call task that Backend/src/services/leads.service.ts already
-- creates on its own). Backend/src/services/leads.service.ts calls
-- autoEnroll(db, leadId, "lead_created", ...) from both createLead()
-- (single-add) and importLeads() (CSV import).
--
-- ALTER TYPE ... ADD VALUE must run in its own migration/transaction --
-- Postgres does not allow a newly added enum value to be used in the same
-- transaction that added it (see the SECTION 2 comment in
-- 001_initial_migration.sql for the enum-growth convention this follows,
-- and 008_meeting_outcome_won.sql for the same pattern applied to a
-- different enum).
alter type public.workflow_trigger add value 'lead_created';
