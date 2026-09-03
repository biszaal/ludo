-- Eight premium boards: four on a coin ladder, four on the gem ladder.
--
-- Why now. The board shelf has not moved since 0013: three skins at 600 coins
-- and, since 0018, one at 250 gems. Meanwhile dice climbed to 75,000 coins
-- (0014) and avatars to 100,000 (0059). So the board — the single surface every
-- player looks at for the entire match, and the only cosmetic that dresses the
-- whole table rather than one seat — was the cheapest thing in the shop. A
-- player with a five-figure balance could buy a die, a face, and then nothing
-- at all for the thing filling their screen.
--
-- Coin ladder: 3,000 / 12,000 / 40,000 / 100,000, the same shape as 0059's
-- avatars rather than a third curve invented for boards. A quick-match win nets
-- ~100-300 coins, so Verdant Garden is a couple of good sessions and Gilded
-- Royal is a long-horizon flex nobody reaches by accident.
--
-- Gem ladder: 260 / 420 / 520 / 600, continuing the 0044/0045/0059 line and
-- topping out at the same 600 as dice.sovereign — under the 750-gem pack, so the
-- top of the line stays reachable by a player who buys once. A ceiling nobody
-- can touch is not a target, it is decoration on a price list.
--
-- What they actually are, because "seven more boards" is the failure mode. Each
-- of these is a place with its own material, marking and light, not a tint of
-- the classic plate:
--
--   garden   Verdant Garden    box hedge, limestone path, brass rail, leaves
--   blossom  Blossom Ink       aubergine ink wash, rice paper, blossoms
--   onyx     Onyx & Brass      black stone tiles, brass rail, deco medallion
--   gilded   Gilded Royal      struck gold plate, ivory field, fleur-de-lis
--   moonlit  Moonlit Garden    the garden after dark, weathered silver
--   nacre    Lacquer & Nacre   oxblood lacquer, mother-of-pearl, gold rail
--   peacock  Peacock Enamel    teal-to-indigo enamel over gold, sunbursts
--   celest'l Celestial Court   a night sky under glass, gold astronomer's rule
--
-- Carrying that took two new client modules, not a longer colour list.
-- render/boardGlyphs.ts marks the safe squares with leaves, blossoms, stones,
-- fleurs and sunbursts instead of the one star; render/boardArt.ts gives each
-- board a MATERIAL (grain, mineral veining, foliage, a star field, water, a
-- damask weave) printed into the four yard plates, and a WORKED EDGE (a Greek
-- key, a rope, pearls, a laurel, deco zigzag, an astronomer's rule) run around
-- both the board's rim and every yard tile. All of it is generated geometry —
-- no image assets, nothing added to the bundle, sharp at every screen density.
--
-- That is 0045's lesson applied to boards, twice over: a prestige tier
-- assembled out of recolors is the one players stop believing in first, and the
-- first cut of this tier WAS recolors — twelve boards made of the same flat
-- rectangles in different colours. Material and ornament are what a player is
-- actually buying at 100,000 coins.
--
-- The four seat colours are re-toned per board (enamel jewels on gold, flowerbed
-- tones in the garden) but never re-hued: red stays red on every surface. A seat
-- colour is a player's identity at the table, and no cosmetic may make two seats
-- harder to tell apart. That is the same line 0018 drew for the avatar chips.
--
-- Still appearance only. Same fairness invariant as 0013/0018/0027/0044/0045/
-- 0059: coins and gems buy ACCESS and APPEARANCE, never an outcome. The engine
-- has no idea which board a table is dressed in — the board theme is a local
-- client setting, and unlike the worn avatar or die there is nothing on the
-- server to spoof, because nobody but its owner ever sees it.
--
-- Parity with the client registry is test-enforced in both directions by
-- __tests__/boardThemes.test.ts (every theme's id, price and currency against
-- the seeded rows) and __tests__/gemCatalog.test.ts, which scan every migration
-- in this directory.

insert into public.catalog (sku, kind, price, currency, active) values
  -- Coin ladder
  ('theme.garden',  'theme', 3000,   'coins', true),
  ('theme.blossom', 'theme', 12000,  'coins', true),
  ('theme.onyx',    'theme', 40000,  'coins', true),
  ('theme.gilded',  'theme', 100000, 'coins', true),
  -- Gem ladder
  ('theme.moonlit', 'theme', 260, 'gems', true),
  ('theme.nacre',   'theme', 420, 'gems', true),
  ('theme.peacock', 'theme', 520, 'gems', true),
  ('theme.celestial', 'theme', 600, 'gems', true)
on conflict (sku) do nothing;
