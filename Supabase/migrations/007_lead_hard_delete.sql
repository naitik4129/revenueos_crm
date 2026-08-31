-- =============================================================================
-- Northbeam CRM -- lead hard delete
-- =============================================================================

-- 001_initial_migration.sql originally shipped leads with no delete policy at
-- all, on the deliberate premise that leads are never hard-deleted (a lead
-- that's no longer a real opportunity moves to lifecycle_state = 'discarded'
-- instead). That premise is being overridden here per an explicit product
-- decision: salespeople now need a true, irreversible "delete forever"
-- action (Backend DELETE /leads/:id) that removes the lead row and, via the
-- existing `on delete cascade` foreign keys on lead_notes,
-- lead_contact_channels, calls, tasks, meetings, proposals, workflow_runs,
-- scheduled_actions, timeline_events, dnc_events and notifications, all of
-- its related data along with it.
--
-- Gated by the same public.is_active_salesperson() check as every other
-- write on this table (see leads_update_active_salesperson above), not a
-- separate admin tier: admin accounts are walled off from all CRM data in
-- this app (crmRouter requires role = 'salesperson', see
-- Backend/src/routes/index.ts and requireSalesperson in
-- Backend/src/authMiddleware.ts) -- they manage system config/integrations
-- via /admin/*, never leads. There is no more-privileged role within CRM
-- data to additionally require.
create policy leads_delete_active_salesperson
  on public.leads
  for delete
  to authenticated
  using (public.is_active_salesperson());

comment on policy leads_delete_active_salesperson on public.leads is
  'Overrides the original "no delete policy" design (see 001_initial_migration.sql history) -- '
  'any active salesperson may now permanently delete a lead, the same authorization bar as every '
  'other write on this table. Irreversible and cascades across every related table.';

-- Standalone audit trail for hard deletes. Deliberately has NO foreign key to
-- leads (it must survive the very cascade it is recording) and is never
-- written to or read by anything except the delete flow -- it does not
-- enable undo, only after-the-fact investigation of what a lead looked like
-- and who removed it.
create table public.deleted_leads_audit (
  id uuid primary key default gen_random_uuid(),

  lead_id uuid not null,
  snapshot jsonb not null,

  deleted_by uuid references public.profiles (id) on delete set null,
  deleted_by_name text,
  deleted_at timestamptz not null default now()
);

comment on table public.deleted_leads_audit is
  'Point-in-time JSON snapshot of a lead taken immediately before it is hard-deleted, plus who '
  'deleted it. No FK to leads (survives the cascade). Investigation-only, not an undo mechanism.';

create index deleted_leads_audit_lead_id_idx on public.deleted_leads_audit (lead_id);

alter table public.deleted_leads_audit enable row level security;

create policy deleted_leads_audit_select_active_salesperson
  on public.deleted_leads_audit
  for select
  to authenticated
  using (public.is_active_salesperson());

create policy deleted_leads_audit_insert_active_salesperson
  on public.deleted_leads_audit
  for insert
  to authenticated
  with check (public.is_active_salesperson());

-- No update/delete policy: audit rows are append-only.
