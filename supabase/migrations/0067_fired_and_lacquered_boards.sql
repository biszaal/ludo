-- Two boards made by hand and by fire: a crackled celadon glaze with cobalt
-- drawn under it, and black urushi lacquer with gold dust scattered across it.
insert into public.catalog (sku, kind, price, currency, active) values
  ('theme.celadon', 'theme', 60000, 'coins', true),
  ('theme.urushi', 'theme', 480, 'gems', true)
on conflict (sku) do nothing;
