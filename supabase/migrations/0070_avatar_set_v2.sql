-- Avatar set v2: twelve new faces, and the existing twenty-one left alone.
--
-- The art. Every avatar in the game was redrawn for this release, but only the
-- ART changed — ids, prices, currencies and entitlements are untouched, because
-- an id is what a profile stores and what an entitlement is written against.
-- A player who bought regis for 100,000 coins still wears regis; he is simply
-- drawn properly now. That is the whole reason the redraw needed no migration
-- of its own, and why this one only adds rows.
--
-- What v1 got wrong, for the record: all twenty-one faces were the same circle
-- with different hair. One head, one pair of eyes, one mouth, and the character
-- lived entirely in the hat. v2 varies the head itself (seven face shapes), the
-- eyes (ten kits), the brows and the mouth, so the set reads as a cast. See
-- apps/mobile/scripts/avatar-art.mjs, which is the source of truth for it.
--
-- The twelve new ones fill two gaps the set had nothing for. Eight are a South
-- Asian line — Mira, Rana, Diya, Rani, and the Himalayan pair Momo and Tashi —
-- which is a strange thing for a Ludo game to have been missing, given where
-- the game and most of its players come from. The rest are the first characters
-- in the catalog who are not human: a robot, a dragon hatchling, an astronaut,
-- a grovekeeper, a phoenix heir, a snow spirit.
--
-- Pricing extends the two existing ladders rather than inventing a third.
--
--   Coins: 0 / 300 / 500 (0013), then 3,000 / 12,000 / 40,000 / 100,000 for
--   Regalia (0059). The gaps in that curve are wide — nothing at all between
--   500 and 3,000, and nothing between 12,000 and 40,000 — so the new faces go
--   where a player actually is rather than where the curve had round numbers:
--   800 and 2,000 for someone a few sessions in, 6,000 and 25,000 for the
--   stretch Regalia left empty. Rani at 150,000 becomes the new coin ceiling,
--   a step past regis, which is the point of a ceiling.
--
--   Gems: 100 (0018), then 260 / 420 / 600 for Celestial (0059). Frost at 150
--   and Vega at 340 sit in that line's gaps. Ember at 700 raises the top, and
--   deliberately stays under the 750-gem pack for 0059's reason: the top of a
--   line has to be reachable by a player who buys once, or it is decoration on
--   a price list rather than a target.
--
-- Still appearance only. Same fairness invariant as 0013/0018/0027/0044/0045/
-- 0059: coins and gems buy ACCESS and APPEARANCE, never an outcome. The engine
-- has no idea which face a seat is wearing.
--
-- Parity with the client registry (apps/mobile/src/render/avatars.ts) is
-- test-enforced in both directions by __tests__/avatars.test.ts, and the gem
-- rows again by __tests__/gemCatalog.test.ts, which scan every migration here.
-- 0059's enforce_avatar_ownership trigger covers these the moment they land:
-- it reads the catalog by sku, so a priced face is spoof-proof with no change.

insert into public.catalog (sku, kind, price, currency, active) values
  -- Coins: the early rungs, a step above 0013's 500-coin band.
  ('avatar.momo',  'avatar', 800,    'coins', true),
  ('avatar.tashi', 'avatar', 800,    'coins', true),
  ('avatar.bolt',  'avatar', 2000,   'coins', true),
  ('avatar.rana',  'avatar', 2000,   'coins', true),
  -- Coins: the stretch between Regalia's laurel (3,000) and saga (12,000).
  ('avatar.mira',  'avatar', 6000,   'coins', true),
  ('avatar.sylva', 'avatar', 6000,   'coins', true),
  -- Coins: between saga (12,000) and pharo (40,000).
  ('avatar.diya',  'avatar', 25000,  'coins', true),
  ('avatar.draco', 'avatar', 25000,  'coins', true),
  -- Coins: the new ceiling, one step past regis (100,000).
  ('avatar.rani',  'avatar', 150000, 'coins', true),
  -- Gems: the gaps in the Celestial line, then a new top under the 750 pack.
  ('avatar.frost', 'avatar', 150, 'gems', true),
  ('avatar.vega',  'avatar', 340, 'gems', true),
  ('avatar.ember', 'avatar', 700, 'gems', true)
on conflict (sku) do nothing;
