-- =============================================================================
-- Northbeam CRM -- administration and production messaging connections
-- =============================================================================

-- Existing identities remain salespeople. Administrators use the same
-- Supabase Auth boundary but are kept out of salesperson CRM routes.
alter table public.profiles
  add column role text not null default 'salesperson';

alter table public.profiles
  add constraint profiles_role_valid check (role in ('admin', 'salesperson'));

create index profiles_role_active_idx on public.profiles (role, is_active);

comment on column public.profiles.role is
  'Application role enforced by the backend. Admin accounts use the separate admin dashboard and are not assignable salespeople.';

drop policy profiles_select_authenticated on public.profiles;

create or replace function public.is_active_salesperson()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = auth.uid()
       and p.is_active = true
       and p.role = 'salesperson'
  );
$$;

create policy profiles_select_active_salesperson
  on public.profiles for select to authenticated
  using (public.is_active_salesperson());

-- Keep the human-entered phone for display and a canonical value for provider
-- sends and deterministic inbound matching. Duplicates are intentionally
-- allowed because the CRM already supports merging duplicate leads.
alter table public.leads add column phone_e164 text;

alter table public.leads
  add constraint leads_phone_e164_valid check (
    phone_e164 is null or phone_e164 ~ '^[+][1-9][0-9]{7,14}$'
  );

with normalized as (
  select id,
         phone,
         regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') as digits
    from public.leads
)
update public.leads l
   set phone_e164 = case
     when n.digits ~ '^91[6-9][0-9]{9}$' then '+' || n.digits
     when n.digits ~ '^[6-9][0-9]{9}$' then '+91' || n.digits
     when n.phone ~ '^[+]' and n.digits ~ '^[1-9][0-9]{7,14}$' then '+' || n.digits
     else null
   end
  from normalized n
 where n.id = l.id;

create index leads_phone_e164_idx on public.leads (phone_e164) where phone_e164 is not null;

-- One row per configurable integration. Non-secret settings stay queryable;
-- the complete secret object is encrypted by the backend with AES-256-GCM.
create table public.integration_connections (
  id text primary key,
  provider text,
  enabled boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  secret_ciphertext bytea,
  secret_iv bytea,
  secret_tag bytea,
  key_version integer not null default 1,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_connections_id_valid check (id in ('email')),
  constraint integration_connections_provider_valid check (
    provider is null or provider in ('resend', 'smtp')
  ),
  constraint integration_connections_secret_complete check (
    (secret_ciphertext is null and secret_iv is null and secret_tag is null)
    or
    (secret_ciphertext is not null and secret_iv is not null and secret_tag is not null)
  )
);

create trigger integration_connections_set_updated_at
  before update on public.integration_connections
  for each row execute function public.set_updated_at();

insert into public.integration_connections (id) values ('email');

-- Append-only administrative audit trail. Secret values and passwords must
-- never be placed in metadata.
create table public.admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  actor_email text not null,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  constraint admin_audit_action_not_blank check (length(trim(action)) > 0),
  constraint admin_audit_target_not_blank check (length(trim(target_type)) > 0)
);

create index admin_audit_created_at_idx on public.admin_audit_events (created_at desc);

create function public.prevent_admin_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'admin_audit_events is append-only';
end;
$$;

create trigger admin_audit_events_immutable
  before update or delete on public.admin_audit_events
  for each row execute function public.prevent_admin_audit_mutation();

-- Database-backed control plane for the single Baileys socket owned by the
-- automation worker. The QR is encrypted because possession can link a device.
create table public.whatsapp_connection (
  id boolean primary key default true check (id),
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
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_desired_state_valid check (desired_state in ('connected', 'disconnected', 'restart')),
  constraint whatsapp_status_valid check (
    status in ('disconnected', 'connecting', 'qr_ready', 'connected', 'reconnecting', 'reauth_required', 'error')
  ),
  constraint whatsapp_qr_complete check (
    (qr_ciphertext is null and qr_iv is null and qr_tag is null and qr_expires_at is null)
    or
    (qr_ciphertext is not null and qr_iv is not null and qr_tag is not null and qr_expires_at is not null)
  ),
  constraint whatsapp_daily_cap_positive check (daily_cap between 1 and 10000),
  constraint whatsapp_delay_valid check (
    min_delay_seconds between 1 and 300
    and max_delay_seconds between min_delay_seconds and 600
  )
);

create trigger whatsapp_connection_set_updated_at
  before update on public.whatsapp_connection
  for each row execute function public.set_updated_at();

insert into public.whatsapp_connection (id) values (true);

-- Baileys credentials and Signal keys are encrypted individually so key-store
-- reads/writes remain efficient without exposing usable session material in a
-- database backup.
create table public.whatsapp_auth_credentials (
  id boolean primary key default true check (id),
  ciphertext bytea not null,
  iv bytea not null,
  tag bytea not null,
  key_version integer not null default 1,
  updated_at timestamptz not null default now()
);

create table public.whatsapp_auth_keys (
  key_type text not null,
  key_id text not null,
  ciphertext bytea not null,
  iv bytea not null,
  tag bytea not null,
  key_version integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (key_type, key_id)
);

-- Prepared outbound rows provide a stable message id across worker retries and
-- retain the encrypted protocol message required by Baileys getMessage.
create table public.whatsapp_outbound_messages (
  id uuid primary key default gen_random_uuid(),
  scheduled_action_id uuid not null unique references public.scheduled_actions (id) on delete cascade,
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
  constraint whatsapp_outbound_status_valid check (status in ('prepared', 'sent', 'failed')),
  constraint whatsapp_outbound_payload_complete check (
    (payload_ciphertext is null and payload_iv is null and payload_tag is null)
    or
    (payload_ciphertext is not null and payload_iv is not null and payload_tag is not null)
  )
);

create index whatsapp_outbound_sent_at_idx on public.whatsapp_outbound_messages (sent_at desc);

-- Intentionally metadata-only: message bodies, captions and downloaded media
-- are not retained.
create table public.whatsapp_inbound_events (
  message_id text primary key,
  sender_jid text not null,
  sender_phone_e164 text,
  message_type text not null,
  received_at timestamptz not null,
  match_count integer not null default 0,
  disposition text not null,
  created_at timestamptz not null default now(),
  constraint whatsapp_inbound_match_count_non_negative check (match_count >= 0),
  constraint whatsapp_inbound_disposition_valid check (
    disposition in ('matched', 'ambiguous', 'unmatched', 'ignored')
  )
);

create index whatsapp_inbound_received_at_idx on public.whatsapp_inbound_events (received_at desc);

-- These tables are never queried directly by the browser. The trusted backend
-- uses a BYPASSRLS role and applies requireAdmin/worker authorization.
alter table public.integration_connections enable row level security;
alter table public.admin_audit_events enable row level security;
alter table public.whatsapp_connection enable row level security;
alter table public.whatsapp_auth_credentials enable row level security;
alter table public.whatsapp_auth_keys enable row level security;
alter table public.whatsapp_outbound_messages enable row level security;
alter table public.whatsapp_inbound_events enable row level security;
