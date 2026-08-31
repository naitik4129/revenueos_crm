-- =============================================================================
-- Northbeam CRM -- Google Calendar sync for meetings (connection, event
-- sync + participants, and auto email/WhatsApp notification on scheduling)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Part 1 — Google Calendar connection (admin-managed, single shared account)
-- -----------------------------------------------------------------------------

-- Single-row control plane for one shared org Google account, mirroring
-- whatsapp_connection's shape (003_admin_integrations_baileys.sql) but for
-- an OAuth2 refresh-token connection rather than a QR/device-session one.
-- No access-token cache is stored: a fresh access token is exchanged from
-- the refresh token before every Calendar API call (see
-- Backend/src/providers/google-calendar.provider.ts) rather than tracking a
-- second short-lived encrypted blob's freshness.
--
-- The OAuth app's own client_id/client_secret/redirect_uri are entered by an
-- admin in Admin -> Connections (never in .env), mirroring exactly how the
-- Resend API key is configured for email: client_id/redirect_uri are stored
-- in plain columns (not secret — redirect_uri is publicly registered in
-- Google Cloud Console anyway), client_secret is AES-256-GCM encrypted like
-- every other provider secret in this schema. Kept separate from
-- connected_email/refresh_token_* so disconnecting the connected account
-- (revoking its refresh token) never forces re-entering the OAuth app's own
-- credentials.
create table public.google_calendar_connection (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  status text not null default 'disconnected',
  client_id text,
  redirect_uri text,
  client_secret_ciphertext bytea,
  client_secret_iv bytea,
  client_secret_tag bytea,
  client_secret_key_version integer not null default 1,
  connected_email text,
  connected_calendar_id text not null default 'primary',
  refresh_token_ciphertext bytea,
  refresh_token_iv bytea,
  refresh_token_tag bytea,
  refresh_token_key_version integer not null default 1,
  pending_oauth_state text,
  pending_oauth_state_expires_at timestamptz,
  last_error text,
  last_synced_at timestamptz,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendar_status_valid check (
    status in ('disconnected', 'connected', 'error')
  ),
  constraint google_calendar_client_secret_complete check (
    (client_secret_ciphertext is null and client_secret_iv is null and client_secret_tag is null)
    or
    (client_secret_ciphertext is not null and client_secret_iv is not null and client_secret_tag is not null)
  ),
  constraint google_calendar_refresh_token_complete check (
    (refresh_token_ciphertext is null and refresh_token_iv is null and refresh_token_tag is null)
    or
    (refresh_token_ciphertext is not null and refresh_token_iv is not null and refresh_token_tag is not null)
  )
);

create trigger google_calendar_connection_set_updated_at
  before update on public.google_calendar_connection
  for each row execute function public.set_updated_at();

insert into public.google_calendar_connection (id) values (true);

-- Never queried directly by the browser — the trusted backend uses a
-- BYPASSRLS role and applies requireAdmin, same as integration_connections
-- and whatsapp_connection.
alter table public.google_calendar_connection enable row level security;

-- -----------------------------------------------------------------------------
-- Part 2 — meeting Google Calendar sync + participants
-- -----------------------------------------------------------------------------

-- Calendar sync is best-effort and must never block scheduling a meeting:
-- 'not_applicable' covers "Calendar isn't connected" (the common case until
-- an admin connects one), 'failed' covers a connected-but-erroring sync, and
-- the meeting's own meeting_url/status are unaffected either way.
alter table public.meetings add column calendar_event_id text;
alter table public.meetings add column meet_link text;
alter table public.meetings add column calendar_sync_status text not null default 'not_applicable';
alter table public.meetings add column calendar_sync_error text;

alter table public.meetings
  add constraint meetings_calendar_sync_status_valid check (
    calendar_sync_status in ('not_applicable', 'pending', 'synced', 'failed')
  );

-- A normalized child table (not jsonb on meetings) because each participant
-- needs an individually validated email and the rest of this schema already
-- normalizes list-like data this way (lead_notes, calls, etc.).
create table public.meeting_participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  name text,
  email text not null,
  created_at timestamptz not null default now(),
  constraint meeting_participants_email_valid check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

comment on table public.meeting_participants is
  'Extra attendees (beyond the lead) added when a meeting is scheduled, added as Google Calendar event attendees. Replaced wholesale (delete+reinsert) on reschedule — no update policy.';

create index meeting_participants_meeting_id_idx on public.meeting_participants (meeting_id);

alter table public.meeting_participants enable row level security;

create policy meeting_participants_select_active_salesperson
  on public.meeting_participants
  for select
  to authenticated
  using (public.is_active_salesperson());

create policy meeting_participants_insert_active_salesperson
  on public.meeting_participants
  for insert
  to authenticated
  with check (public.is_active_salesperson());

create policy meeting_participants_delete_active_salesperson
  on public.meeting_participants
  for delete
  to authenticated
  using (public.is_active_salesperson());

-- No update policy: participants are replaced wholesale, not edited in place.

-- -----------------------------------------------------------------------------
-- Part 3 — auto email/WhatsApp notification on meeting scheduled
-- -----------------------------------------------------------------------------

-- One fixed default template per channel, set once by an admin in the
-- Templates page, auto-applied to every "meeting scheduled" send — no
-- per-meeting template picker. Partial unique indexes (not a CHECK, which
-- can't express cross-row uniqueness) enforce at most one default per
-- channel; the service clears the previous default before setting a new one.
alter table public.message_templates add column is_default_meeting_scheduled_email boolean not null default false;
alter table public.message_templates add column is_default_meeting_scheduled_whatsapp boolean not null default false;

create unique index message_templates_one_default_meeting_email
  on public.message_templates (is_default_meeting_scheduled_email)
  where is_default_meeting_scheduled_email;

create unique index message_templates_one_default_meeting_whatsapp
  on public.message_templates (is_default_meeting_scheduled_whatsapp)
  where is_default_meeting_scheduled_whatsapp;

-- Per-channel notification tracking on meetings, mirroring proposals'
-- email_send_status/whatsapp_send_status columns (005_proposal_send.sql).
alter table public.meetings add column notify_email_status text not null default 'not_applicable';
alter table public.meetings add column notify_email_sent_at timestamptz;
alter table public.meetings add column notify_email_error text;

alter table public.meetings add column notify_whatsapp_status text not null default 'not_applicable';
alter table public.meetings add column notify_whatsapp_sent_at timestamptz;
alter table public.meetings add column notify_whatsapp_error text;
alter table public.meetings add column notify_whatsapp_next_attempt_at timestamptz;
alter table public.meetings add column notify_whatsapp_attempt_count integer not null default 0;

alter table public.meetings
  add constraint meetings_notify_email_status_valid check (
    notify_email_status in ('not_applicable', 'pending', 'skipped', 'sent', 'failed')
  );
alter table public.meetings
  add constraint meetings_notify_whatsapp_status_valid check (
    notify_whatsapp_status in ('not_applicable', 'skipped', 'queued', 'sending', 'sent', 'failed')
  );

create index meetings_notify_whatsapp_queue_idx
  on public.meetings (notify_whatsapp_next_attempt_at)
  where notify_whatsapp_status = 'queued';

-- Generalizes WhatsApp outbound tracking to a third human-initiated source,
-- exactly mirroring how 005_proposal_send.sql added proposal_id alongside
-- scheduled_action_id.
alter table public.whatsapp_outbound_messages add column meeting_id uuid unique references public.meetings (id) on delete cascade;
alter table public.whatsapp_outbound_messages drop constraint whatsapp_outbound_exactly_one_source;
alter table public.whatsapp_outbound_messages
  add constraint whatsapp_outbound_exactly_one_source check (
    ((scheduled_action_id is not null)::int + (proposal_id is not null)::int + (meeting_id is not null)::int) = 1
  );
