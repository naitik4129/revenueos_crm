-- 017_crm_whatsapp_safety.sql
-- WhatsApp safety (scale step 11):
--  * `opted_in` on the WhatsApp channel: one of the three ways a contact counts as engaged
--    (with an inbound reply or a connected call); workflow WhatsApp never goes to anyone else.
--  * Spacing between WhatsApp sends defaults to 45-120 s (was 5-15 s); rows still on the old
--    defaults move too.

begin;

alter table crm.contact_channels
  drop constraint contact_channels_valid_status,
  add constraint contact_channels_valid_status check (
    (channel = 'phone' and status in
      ('valid', 'reachable', 'temporarily_unreachable', 'invalid', 'wrong_number', 'do_not_contact'))
    or (channel = 'email' and status in
      ('valid', 'delivered', 'temporary_bounce', 'permanent_bounce', 'unsubscribed', 'invalid'))
    or (channel = 'whatsapp' and status in
      ('valid', 'reachable', 'temporarily_unreachable', 'invalid', 'opted_in', 'opted_out', 'do_not_contact'))
  );

alter table crm.whatsapp_connection
  alter column min_delay_seconds set default 45,
  alter column max_delay_seconds set default 120;

update crm.whatsapp_connection set min_delay_seconds = 45, max_delay_seconds = 120
 where min_delay_seconds = 5 and max_delay_seconds = 15;

commit;
