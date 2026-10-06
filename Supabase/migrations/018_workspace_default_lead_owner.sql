-- =============================================================================
-- Northbeam CRM -- default owner for website-form leads (per workspace)
-- =============================================================================
--
-- Leads created automatically from the public website contact form
-- (POST /api/v1/public/leads, see Backend/src/services/leadIngest.service.ts)
-- have no logged-in user to inherit an owner from. This column lets each
-- workspace choose which salesperson owns them, editable from the CRM's
-- Settings page rather than from server configuration.
--
-- Purely additive and idempotent: one nullable column, no backfill, no change
-- to any existing row or behaviour. NULL (the starting value for every
-- workspace) means "leave website leads unassigned and notify every active
-- salesperson", which is exactly how the endpoint behaved before this column
-- existed. Safe to apply BEFORE the new backend code is deployed (old code
-- never reads it) and safe to leave applied if the code is rolled back.
--
-- ON DELETE SET NULL, matching leads.owner_id: removing a profile must never
-- break a workspace; website leads simply fall back to unassigned. The
-- backend additionally ignores an owner who is deactivated or no longer a
-- salesperson.
-- =============================================================================

alter table public.workspaces
  add column if not exists default_lead_owner_id uuid references public.profiles (id) on delete set null;

comment on column public.workspaces.default_lead_owner_id is
  'Salesperson who owns new leads created from the public website form. NULL = unassigned (all '
  'active salespeople are notified instead). Set from Settings -> Website leads.';
