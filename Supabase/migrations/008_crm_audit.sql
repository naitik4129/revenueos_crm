-- 008_crm_audit.sql
-- deleted_records_audit (snapshot of every permanently deleted company/contact/deal) and
-- admin_audit_events (append-only log of admin actions).

begin;

-- No FK on entity_id: the record is gone. workspace_id is kept if the workspace survives.
create table crm.deleted_records_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references crm.workspaces (id) on delete set null,
  entity_type text not null,
  entity_id uuid not null,
  snapshot jsonb not null,
  deleted_by uuid references crm.profiles (id) on delete set null,
  deleted_by_name text,
  deleted_at timestamptz not null default now(),
  constraint deleted_records_audit_entity_type_valid check (entity_type in ('company', 'contact', 'deal'))
);

create index deleted_records_audit_entity_idx on crm.deleted_records_audit (entity_type, entity_id);
create index deleted_records_audit_workspace_idx on crm.deleted_records_audit (workspace_id, deleted_at desc);

create table crm.admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references crm.profiles (id) on delete set null,
  actor_email text not null,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  constraint admin_audit_action_not_blank check (length(trim(action)) > 0),
  constraint admin_audit_target_not_blank check (length(trim(target_type)) > 0)
);

create index admin_audit_created_at_idx on crm.admin_audit_events (created_at desc);

create function crm.prevent_admin_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The only allowed change: actor_id -> null when that profile is deleted (FK on delete set null).
  if tg_op = 'UPDATE' and new.actor_id is null
     and (to_jsonb(new) - 'actor_id') = (to_jsonb(old) - 'actor_id') then
    return new;
  end if;
  raise exception 'admin_audit_events is append-only';
end;
$$;

create trigger admin_audit_events_immutable
  before update or delete on crm.admin_audit_events
  for each row execute function crm.prevent_admin_audit_mutation();

commit;
