-- The material board tier: boards built from a described material rather than
-- from a palette — a brushed titanium deck inside a bronze rail, and the sets
-- that follow it.
--
-- Board themes are equipped client-side (see 0061), so there is no profile
-- column and no trigger here. All the server owns is the price and the
-- entitlement, which is exactly what the shop needs to sell one.
insert into public.catalog (sku, kind, price, currency, active) values
  ('theme.titanium', 'theme', 380, 'gems', true)
on conflict (sku) do nothing;
