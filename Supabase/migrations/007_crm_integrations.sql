-- 007_crm_integrations.sql
-- Per-workspace provider state: email (Resend/SMTP), Google Calendar, WhatsApp (Baileys).
-- Secrets are AES-GCM encrypted by the backend (ciphertext/iv/tag); never stored in plain text.
-- Rows are created by the backend when a workspace first saves settings (no seed rows).

begin;

create table crm.integration_connections (
  workspace_id uuid not null references crm.workspaces (id) on delete cascade,
  id text not null,
  provider text,
  enabled boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  secret_ciphertext bytea,
  secret_iv bytea,
  secret_tag bytea,
  key_version integer not null default 1,
  updated_by uuid references crm.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  constraint integration_connections_id_valid check (id in ('email')),
  constraint integration_connections_provider_valid check (provider is null or provider in ('resend', 'smtp')),
  constraint integration_connections_secret_complete check (
    (secret_ciphertext is null and secret_iv is null and secret_tag is null)
    or (secret_ciphertext is not null and secret_iv is not null and secret_tag is not null)
  )
);

create table crm.google_calendar_connection (
  workspace_id uuid primary key references crm.workspaces (id) on delete cascade,
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
  pending_oauth_state text unique,
  pending_oauth_state_expires_at timestamptz,
  last_error text,
  last_synced_at timestamptz,
  updated_by uuid references crm.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendar_status_valid check (status in ('disconnected', 'connected', 'error')),
  constraint google_calendar_client_secret_complete check (
    (client_secret_ciphertext is null and client_secret_iv is null and client_secret_tag is null)
    or (client_secret_ciphertext is not null and client_secret_iv is not null and client_secret_tag is not null)
  ),
  constraint google_calendar_refresh_token_complete check (
    (refresh_token_ciphertext is null and refresh_token_iv is null and refresh_token_tag is null)
    or (refresh_token_ciphertext is not null and refresh_token_iv is not null and refresh_token_tag is not null)
  )
);

create table crm.whatsapp_connection (
  workspace_id uuid primary key references crm.workspaces (id) on delete cascade,
  enabled boolean not null default false,
  desired_state text not null default 'disconnected',
  status text not null default 'disconnected',
  command_version bigint not null default 0,
  connected_jid text,
  connected_phone text,
  display_name text,
  qr_ciphertext bytea,
  qr_iv bytea,
  qr_tag bytea,
  qr_key_version integer not null default 1,
  qr_expires_at timestamptz,
  last_error text,
  reachout_lock jsonb,
  new_chat_cap jsonb,
  worker_heartbeat_at timestamptz,
  last_connected_at timestamptz,
  last_disconnected_at timestamptz,
  daily_cap integer not null default 200,
  min_delay_seconds integer not null default 5,
  max_delay_seconds integer not null default 15,
  updated_by uuid references crm.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_desired_state_valid check (desired_state in ('connected', 'disconnected', 'restart')),
  constraint whatsapp_status_valid check (
    status in ('disconnected', 'connecting', 'qr_ready', 'connected', 'reconnecting', 'reauth_required', 'error')
  ),
  constraint whatsapp_qr_complete check (
    (qr_ciphertext is null and qr_iv is null and qr_tag is null and qr_expires_at is null)
    or (qr_ciphertext is not null and qr_iv is not null and qr_tag is not null and qr_expires_at is not null)
  ),
  constraint whatsapp_daily_cap_positive check (daily_cap between 1 and 10000),
  constraint whatsapp_delay_valid check (
    min_delay_seconds between 1 and 300
    and max_delay_seconds between min_delay_seconds and 600
  )
);

create table crm.whatsapp_auth_credentials (
  workspace_id uuid primary key references crm.workspaces (id) on delete cascade,
  ciphertext bytea not null,
  iv bytea not null,
  tag bytea not null,
  key_version integer not null default 1,
  updated_at timestamptz not null default now()
);

create table crm.whatsapp_auth_keys (
  workspace_id uuid not null references crm.workspaces (id) on delete cascade,
  key_type text not null,
  key_id text not null,
  ciphertext bytea not null,
  iv bytea not null,
  tag bytea not null,
  key_version integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, key_type, key_id)
);

-- One row per outbound WhatsApp send, from exactly one source (workflow step, proposal or meeting).
create table crm.whatsapp_outbound_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces (id) on delete cascade,
  contact_id uuid not null,
  scheduled_action_id uuid unique,
  proposal_id uuid unique,
  meeting_id uuid unique,
  message_id text not null unique,
  remote_jid text not null,
  payload_ciphertext bytea,
  payload_iv bytea,
  payload_tag bytea,
  key_version integer not null default 1,
  status text not null default 'prepared',
  last_error text,
  prepared_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint whatsapp_outbound_contact_fk foreign key (contact_id, workspace_id)
    references crm.contacts (id, workspace_id) on delete cascade,
  constraint whatsapp_outbound_scheduled_action_fk foreign key (scheduled_action_id, workspace_id)
    references crm.scheduled_actions (id, workspace_id) on delete cascade,
  constraint whatsapp_outbound_proposal_fk foreign key (proposal_id, workspace_id)
    references crm.proposals (id, workspace_id) on delete cascade,
  constraint whatsapp_outbound_meeting_fk foreign key (meeting_id, workspace_id)
    references crm.meetings (id, workspace_id) on delete cascade,
  constraint whatsapp_outbound_status_valid check (status in ('prepared', 'sent', 'failed')),
  constraint whatsapp_outbound_exactly_one_source check (
    ((scheduled_action_id is not null)::int + (proposal_id is not null)::int + (meeting_id is not null)::int) = 1
  ),
  constraint whatsapp_outbound_payload_complete check (
    (payload_ciphertext is null and payload_iv is null and payload_tag is null)
    or (payload_ciphertext is not null and payload_iv is not null and payload_tag is not null)
  )
);

create index whatsapp_outbound_workspace_sent_at_idx on crm.whatsapp_outbound_messages (workspace_id, sent_at desc);
create index whatsapp_outbound_contact_id_idx on crm.whatsapp_outbound_messages (contact_id);

-- Inbound reply metadata only, never the message body. contact_id is set when exactly one
-- contact matched; ambiguous/unmatched rows wait for review.
create table crm.whatsapp_inbound_events (
  workspace_id uuid not null references crm.workspaces (id) on delete cascade,
  message_id text not null,
  contact_id uuid,
  sender_jid text not null,
  sender_phone_e164 text,
  message_type text not null,
  received_at timestamptz not null,
  match_count integer not null default 0,
  disposition text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, message_id),
  constraint whatsapp_inbound_contact_fk foreign key (contact_id, workspace_id)
    references crm.contacts (id, workspace_id) on delete set null (contact_id),
  constraint whatsapp_inbound_match_count_non_negative check (match_count >= 0),
  constraint whatsapp_inbound_disposition_valid check (disposition in ('matched', 'ambiguous', 'unmatched', 'ignored'))
);

create index whatsapp_inbound_workspace_received_at_idx on crm.whatsapp_inbound_events (workspace_id, received_at desc);
create index whatsapp_inbound_contact_id_idx on crm.whatsapp_inbound_events (contact_id) where contact_id is not null;

commit;
