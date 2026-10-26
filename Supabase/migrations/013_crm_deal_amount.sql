-- 013_crm_deal_amount.sql
-- deals.amount: the deal's value, for the deal page, the deals list and the board's stage totals.
-- One currency for now (INR); the check is the only thing to drop when that changes.
-- The brain's qualified handover may send an amount; it only fills an empty one.

begin;

alter table public.crm_deals
  add column amount numeric(14, 2),
  add column currency text not null default 'INR',
  add constraint crm_deals_amount_non_negative check (amount is null or amount >= 0),
  add constraint crm_deals_currency_inr check (currency = 'INR');

commit;
