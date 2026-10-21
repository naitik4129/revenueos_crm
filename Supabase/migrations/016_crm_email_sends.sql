-- 016_crm_email_sends.sql
-- One row per real workflow (nurture) email handed to the provider. The Resend webhook finds a
-- bounce or complaint's workspace and contact by provider_message_id, and the email channel's
-- auto-pause reads the 7-day bounce + complaint rate from here (email-safety.service.ts).

begin;

create table crm.email_sends (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces (id) on delete cascade,
  contact_id uuid references crm.contacts (id) on delete set null,
  scheduled_action_id uuid references crm.scheduled_actions (id) on delete set null,
  provider_message_id text not null,
  to_email text not null,
  sent_at timestamptz not null default now(),
  bounced_at timestamptz,
  complained_at timestamptz,
  constraint email_sends_provider_message_id_key unique (provider_message_id)
);

create index email_sends_workspace_sent_idx on crm.email_sends (workspace_id, sent_at);

alter table crm.email_sends enable row level security;
revoke all on crm.email_sends from public, anon, authenticated;

commit;
