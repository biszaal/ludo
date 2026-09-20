-- The engineered sets: a twill carbon monocoque, a stitched leather travel
-- board, and the cast-glass flagship.
insert into public.catalog (sku, kind, price, currency, active) values
  ('theme.carbon', 'theme', 30000, 'coins', true),
  ('theme.voyager', 'theme', 90000, 'coins', true),
  ('theme.glacier', 'theme', 620, 'gems', true)
on conflict (sku) do nothing;
