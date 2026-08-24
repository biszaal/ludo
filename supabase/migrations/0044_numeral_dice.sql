-- The Numerals line: four gem-priced dice skins that ink a single figure on
-- each face instead of a pip cluster.
--
-- Why a new marking at all. Pips are the one part of a die every skin so far
-- has left alone — cherry, walnut, galaxy and obsidian-king all recolor and
-- reshape the dots, but a 5 is still five things in a quincunx. A numeral is
-- the first change to WHAT a face says rather than how it is painted, and it
-- is what makes this tier legible as a tier from across the board: you can
-- tell at a glance that someone is playing with a bought die.
--
-- It changes nothing about the roll. A numeral face is drawn by the client
-- (apps/mobile/src/render/dieNumerals.ts) from the same value the server
-- generated; the engine neither knows nor cares which marking a player's skin
-- uses. That is the 0013/0018/0027 fairness invariant, unchanged: gems buy
-- ACCESS and APPEARANCE, never an outcome. If a skin ever needs a gameplay
-- property, that is a design smell, not a schema change.
--
-- Pricing sits on the gem scale established by 0018 (prism, 150) and reaches
-- 420 at the top — roughly the mid pack, and a long way under the 750-gem one,
-- so the flagship is a real target for a player who buys once rather than a
-- wall. The four are one light, two jewel tones and one dark flagship, chosen
-- so no two read alike on a board and none reads as the free classic die.
--
-- Parity with the client registry (render/diceSkins.ts) is test-enforced in
-- both directions by __tests__/diceSkins.test.ts and __tests__/gemCatalog.test.ts,
-- which scan every migration in this directory — a row here with no registry
-- entry is an unpurchasable phantom, and a registry entry with no row here is
-- a shop tile whose Buy button cannot work.

insert into public.catalog (sku, kind, price, currency, active) values
  ('dice.ivory',   'dice', 180, 'gems', true),
  ('dice.jade',    'dice', 260, 'gems', true),
  ('dice.oxblood', 'dice', 320, 'gems', true),
  ('dice.bullion', 'dice', 420, 'gems', true)
on conflict (sku) do nothing;
