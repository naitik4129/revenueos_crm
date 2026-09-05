-- =============================================================================
-- Northbeam CRM -- proposals: loss reason
-- =============================================================================
--
-- rejected/expired proposals do not by themselves move the parent lead's
-- lifecycle to 'lost' (routeProposalStatus routes both to
-- lifecycle_state = 'long_term_nurture' -- see Backend/src/domain/proposalRouting.ts),
-- so the loss reason is captured here, on the proposal, rather than forced
-- onto public.leads.loss_reason (which is reserved for an explicit
-- lead-level markLost call -- see 012_lead_fields.sql).
alter table public.proposals add column loss_reason public.lead_loss_reason;
alter table public.proposals add column loss_notes text;

alter table public.proposals
  add constraint proposals_loss_has_reason
  check (status not in ('rejected', 'expired') or loss_reason is not null);

create index proposals_loss_reason_idx on public.proposals (loss_reason) where loss_reason is not null;
