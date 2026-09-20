-- The engineered sets: a twill carbon monocoque, a stitched leather travel
-- board, and the cast-glass flagship.
insert into public.catalog (sku, kind, price, currency, active) values
  ('theme.carbon', 'theme', 30000, 'coins', true),
  ('theme.voyager', 'theme', 90000, 'coins', true),
  ('theme.glacier', 'theme', 620, 'gems', true)
on conflict (sku) do nothing;

-- The matching dice. Each set sells as a board and a pair that can also go
-- separately, so these are ordinary `dice.*` rows priced under their board.
insert into public.catalog (sku, kind, price, currency, active) values
  ('dice.carbon', 'dice', 22000, 'coins', true),
  ('dice.celadon', 'dice', 45000, 'coins', true),
  ('dice.riverstone', 'dice', 55000, 'coins', true),
  ('dice.voyager', 'dice', 70000, 'coins', true),
  ('dice.titanium', 'dice', 340, 'gems', true),
  ('dice.herbarium', 'dice', 380, 'gems', true),
  ('dice.urushi', 'dice', 420, 'gems', true),
  ('dice.amber', 'dice', 440, 'gems', true),
  ('dice.glacier', 'dice', 560, 'gems', true)
on conflict (sku) do nothing;
