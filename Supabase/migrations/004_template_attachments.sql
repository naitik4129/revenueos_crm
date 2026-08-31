-- =============================================================================
-- Northbeam CRM -- rich-text template bodies and template attachments
-- =============================================================================

-- message_templates.attachment_reference was a placeholder text pointer that
-- no code path ever read or wrote (see 001_initial_migration.sql). Real
-- attachment storage below replaces it outright.
alter table public.message_templates drop column attachment_reference;

-- Private bucket for template attachments. All reads/writes go through the
-- backend's service-role Supabase client (Backend/src/supabaseAdmin.ts) --
-- the frontend only ever holds the anon key, so it has no credential capable
-- of writing here. No storage.* RLS policies are added because the
-- service-role key bypasses RLS entirely and is the only writer.
insert into storage.buckets (id, name, public)
values ('template-attachments', 'template-attachments', false)
on conflict (id) do nothing;

create table public.template_attachments (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.message_templates (id) on delete cascade,

  file_name text not null,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes integer not null,

  created_at timestamptz not null default now(),

  constraint template_attachments_file_name_not_blank check (length(trim(file_name)) > 0),
  constraint template_attachments_size_positive check (size_bytes > 0)
);

comment on table public.template_attachments is
  'Files attached to a message_templates row and sent alongside it. WhatsApp '
  'templates are limited to one attachment (enforced in the backend service '
  'layer, not here) because WhatsApp sends are built around exactly one '
  'Baileys message per scheduled action; email templates may have several.';

create index template_attachments_template_id_idx on public.template_attachments (template_id);

alter table public.template_attachments enable row level security;

create policy template_attachments_select_active_salesperson
  on public.template_attachments
  for select
  to authenticated
  using (public.is_active_salesperson());

create policy template_attachments_insert_active_salesperson
  on public.template_attachments
  for insert
  to authenticated
  with check (public.is_active_salesperson());

create policy template_attachments_delete_active_salesperson
  on public.template_attachments
  for delete
  to authenticated
  using (public.is_active_salesperson());

-- No update policy: attachments are immutable -- replace by delete + re-upload.
