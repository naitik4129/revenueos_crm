-- =============================================================================
-- Northbeam CRM -- proposal document upload + one-click email/WhatsApp send
-- =============================================================================

-- Real document storage, replacing document_reference (a plain text
-- placeholder — see 001_initial_migration.sql SECTION 10) for new proposals.
-- Old rows keep their document_reference untouched for historical display.
alter table public.proposals add column document_storage_path text;
alter table public.proposals add column document_file_name text;
alter table public.proposals add column document_mime_type text;
alter table public.proposals add column document_size_bytes integer;

-- The email/WhatsApp templates chosen when the proposal was sent.
alter table public.proposals add column email_template_id uuid references public.message_templates (id) on delete set null;
alter table public.proposals add column whatsapp_template_id uuid references public.message_templates (id) on delete set null;

-- Per-channel send tracking. Flat columns rather than a log table: a
-- proposal is sent at most once per channel today (no resend/history
-- feature yet) — if that changes, promote this to a proposal_sends table.
alter table public.proposals add column email_send_status text not null default 'not_applicable';
alter table public.proposals add column email_sent_at timestamptz;
alter table public.proposals add column email_send_error text;

alter table public.proposals add column whatsapp_send_status text not null default 'not_applicable';
alter table public.proposals add column whatsapp_sent_at timestamptz;
alter table public.proposals add column whatsapp_send_error text;
alter table public.proposals add column whatsapp_next_attempt_at timestamptz;
alter table public.proposals add column whatsapp_attempt_count integer not null default 0;

alter table public.proposals
  add constraint proposals_email_send_status_valid check (
    email_send_status in ('not_applicable', 'pending', 'skipped', 'sent', 'failed')
  );
alter table public.proposals
  add constraint proposals_whatsapp_send_status_valid check (
    whatsapp_send_status in ('not_applicable', 'skipped', 'queued', 'sending', 'sent', 'failed')
  );

create index proposals_whatsapp_send_queue_idx
  on public.proposals (whatsapp_next_attempt_at)
  where whatsapp_send_status = 'queued';

-- Private bucket for proposal documents, mirroring template-attachments
-- (004_template_attachments.sql) exactly: only the backend's service-role
-- Supabase client ever reads/writes it, so no storage.* RLS policies.
insert into storage.buckets (id, name, public)
values ('proposal-documents', 'proposal-documents', false)
on conflict (id) do nothing;

-- Generalizes WhatsApp outbound tracking beyond workflow-driven sends: a
-- proposal "Send" is a human-initiated, ad hoc WhatsApp message with no
-- scheduled_actions row behind it (a workflow step's template is fixed at
-- definition time; a proposal needs a per-send, user-chosen template).
-- Every shared safety mechanism (emergency switch, daily cap, spacing,
-- connection checks) stays computed generically across this whole table
-- regardless of which source column is populated.
alter table public.whatsapp_outbound_messages alter column scheduled_action_id drop not null;
alter table public.whatsapp_outbound_messages add column proposal_id uuid unique references public.proposals (id) on delete cascade;
alter table public.whatsapp_outbound_messages
  add constraint whatsapp_outbound_exactly_one_source check (
    ((scheduled_action_id is not null)::int + (proposal_id is not null)::int) = 1
  );
