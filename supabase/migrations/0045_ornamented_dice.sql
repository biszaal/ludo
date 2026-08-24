-- Three more gem dice, and the first ones carrying ornament rather than only a
-- material: a petal rosette, an Art Deco sunburst, and engine-turned guilloché
-- (apps/mobile/src/render/faceMotifs.ts).
--
-- Why the tier needed this. 0044's four skins are distinguished by what they
-- are made of — bone, jade, lacquer, graphite — and a finish on top. That works
-- exactly once. Material runs out of ways to look more expensive well before
-- price does, and the next four "premium" dice would have been four more colors
-- of the same idea, which is how a cosmetic tier stops feeling like a tier. A
-- struck figure on the face is a different axis, so these read as a step up
-- rather than a lateral move, and it leaves the axis open for later sets.
--
-- Still nothing but appearance. The motif is drawn client-side behind a numeral
-- whose value the server generated; the engine has no idea a skin exists. Same
-- 0013/0018/0027/0044 fairness invariant: gems buy ACCESS and APPEARANCE, never
-- an outcome.
--
-- Prices continue 0044's gem ladder (180/260/320/420) rather than resetting it.
-- 600 for the flagship sits just under the 750-gem pack, so the top of the line
-- is reachable by a player who buys once — a ceiling nobody can touch is not a
-- target, it is decoration on a price list.
--
-- Parity with the client registry is test-enforced in both directions by
-- __tests__/diceSkins.test.ts and __tests__/gemCatalog.test.ts, which scan every
-- migration in this directory.

insert into public.catalog (sku, kind, price, currency, active) values
  ('dice.bloom',     'dice', 460, 'gems', true),
  ('dice.lapis',     'dice', 520, 'gems', true),
  ('dice.sovereign', 'dice', 600, 'gems', true)
on conflict (sku) do nothing;
