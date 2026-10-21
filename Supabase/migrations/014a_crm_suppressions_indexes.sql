-- 014a_crm_suppressions_indexes.sql
-- GET /brain/v1/suppressions as a change feed: each poll reads only the channel changes and
-- DNC lifts after its cursor, so both need an index on their time column.
-- Indexes only; no data changes. Safe to run before or after 014.

begin;

create index contact_channels_updated_at_idx on crm.contact_channels (updated_at);
create index dnc_events_reactivated_at_idx on crm.dnc_events (created_at) where action = 'reactivated';

commit;
