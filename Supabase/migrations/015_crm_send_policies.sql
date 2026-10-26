-- 015_crm_send_policies.sql
-- Sending limits per workspace and channel (email, whatsapp), enforced by the worker right before
-- every workflow send (send-policy.service.ts): paused -> working hours (Asia/Kolkata) -> daily cap
-- with warm-up ramp -> random gap -> consent. Over a limit the send waits for the next allowed
-- time; nothing is dropped. Rows are created on first use with these defaults; admins edit them.

begin;

create table public.crm_send_policies (
  workspace_id uuid not null references public.crm_workspaces (id) on delete cascade,
  channel text not null,
  paused boolean not null default false,
  pause_reason text,
  paused_at timestamptz,
  -- Today's cap = least(daily_cap, ramp_start + ramp_step_per_day * whole IST days since ramp_started_at).
  daily_cap integer not null,
  ramp_start integer not null default 20,
  ramp_step_per_day integer not null default 5,
  ramp_started_at timestamptz,
  min_gap_seconds integer not null,
  max_gap_seconds integer not null,
  -- Working window, Asia/Kolkata. Days are ISO (1 = Monday ... 7 = Sunday).
  window_start time not null default '09:00',
  window_end time not null default '19:00',
  window_days smallint[] not null default '{1,2,3,4,5}',
  -- Sends reserved today (IST day in counter_day) and the earliest time the next one may go.
  counter_day date,
  sent_today integer not null default 0,
  next_send_at timestamptz,
  updated_by uuid references public.crm_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, channel),
  constraint crm_send_policies_channel_valid check (channel in ('email', 'whatsapp')),
  constraint crm_send_policies_cap_valid check (daily_cap between 1 and 2000 and ramp_start between 1 and 2000 and ramp_step_per_day between 0 and 500),
  constraint crm_send_policies_gap_valid check (min_gap_seconds between 0 and 3600 and max_gap_seconds between min_gap_seconds and 7200),
  constraint crm_send_policies_window_valid check (window_start < window_end),
  constraint crm_send_policies_days_valid check (cardinality(window_days) between 1 and 7 and window_days <@ '{1,2,3,4,5,6,7}'::smallint[]),
  constraint crm_send_policies_pause_reason check (not paused or pause_reason is not null)
);

create trigger crm_send_policies_set_updated_at before update on public.crm_send_policies
  for each row execute function public.crm_set_updated_at();

select public.crm_secure_objects();

commit;
