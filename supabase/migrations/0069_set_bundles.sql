-- Sets: a board and its matching dice, bought together for less than the two
-- apart.
--
-- A `set.*` sku is not a thing anyone equips. It is a cheaper way to buy
-- `theme.<key>` and `dice.<key>` in one go, so what a purchase leaves in
-- entitlements is the two PARTS plus the set row itself as a receipt. That
-- matters for everything downstream: the client already decides what is owned
-- by looking for `theme.x` and `dice.x`, and it keeps doing exactly that
-- without learning what a set is.
alter table public.catalog drop constraint if exists catalog_kind_check;
alter table public.catalog add constraint catalog_kind_check
  check (kind in ('theme', 'avatar', 'entitlement', 'dice', 'set'));

-- Priced at the design's bundle, roughly 20% under board + dice apart.
insert into public.catalog (sku, kind, price, currency, active) values
  ('set.carbon', 'set', 45000, 'coins', true),
  ('set.celadon', 'set', 85000, 'coins', true),
  ('set.riverstone', 'set', 105000, 'coins', true),
  ('set.voyager', 'set', 130000, 'coins', true),
  ('set.titanium', 'set', 580, 'gems', true),
  ('set.herbarium', 'set', 660, 'gems', true),
  ('set.urushi', 'set', 720, 'gems', true),
  ('set.amber', 'set', 760, 'gems', true),
  ('set.glacier', 'set', 940, 'gems', true)
on conflict (sku) do nothing;
