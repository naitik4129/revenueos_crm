-- 014a_crm_suppressions_indexes.sql
-- GET /brain/v1/suppressions as a change feed: each poll reads only the channel changes and
-- DNC lifts after its cursor, so both need an index on their time column.
-- Indexes only; no data changes. Safe to run before or after 014.

begin;

create index crm_contact_channels_updated_at_idx on public.crm_contact_channels (updated_at);
create index crm_dnc_events_reactivated_at_idx on public.crm_dnc_events (created_at) where action = 'reactivated';

commit;
