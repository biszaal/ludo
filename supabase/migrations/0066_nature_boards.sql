-- The nature sets: boards made of a material that was alive, or that trapped
-- something that was. Moss on streambed slate, pressed specimens on cotton rag,
-- a frond suspended in amber.
insert into public.catalog (sku, kind, price, currency, active) values
  ('theme.riverstone', 'theme', 75000, 'coins', true),
  ('theme.herbarium', 'theme', 440, 'gems', true),
  ('theme.amber', 'theme', 500, 'gems', true)
on conflict (sku) do nothing;
