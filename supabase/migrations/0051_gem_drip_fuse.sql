-- Lengthen the fuse on the rewarded-gem drip: 2 gems a view, still 5 a day.
--
-- 0048 opened this to 5 x 5/day two days ago, deliberately, because ads are how
-- a young game earns before anyone will pay. That reasoning stands. The number
-- did not.
--
-- What the number did, measured against the live catalog:
--
--   the whole gem catalog          3,360 gems (11 items, 100-600 each)
--   free income at 5 x 5/day         750 gems a month
--   time to own everything           ~4.5 months
--
-- So the most engaged player — the one watching every ad every day, the one the
-- strategy depends on — runs out of things to want in a season, and rewarded
-- ads stop having a reward. Ad revenue from exactly the wrong cohort goes to
-- zero, permanently. That is not a pricing problem; repricing packs would not
-- have touched it.
--
-- The fix rests on the two dials being independent, which is easy to miss
-- because 0048 moved both at once:
--
--   dailyCap  = how many ads get WATCHED       -> the revenue
--   amount    = how fast the catalog DRAINS    -> the fuse
--
-- dailyCap is untouched at 5, so impressions per player per day, and therefore
-- ad revenue, are exactly what 0048 intended. amount drops 5 -> 2, which takes
-- free income to 300/month and the fuse from ~4.5 months to ~11. The $9.99
-- 750-gem pack becomes "skip about two and a half months of watching" instead
-- of "buy what a month of watching gives away".
--
-- Pack prices are deliberately NOT touched. There has been exactly one purchase
-- ever, so there is nothing to price against, and changing numbers you cannot
-- measure is guessing dressed as strategy.
--
-- FAIRNESS INVARIANT (0013, 0018, 0027, 0048) untouched and non-negotiable:
-- gems buy ACCESS and APPEARANCE. A player with any number of gems has nicer
-- pawns and no better chance of winning a single match.
--
-- Still config, so still walk-backable without a store release.
--
-- The client's DEFAULT_CONFIG fallback moves with this (configStore.ts). It is
-- only what the Get Gems sheet shows before the server's config arrives — the
-- grant itself is server-side (economy.ts) and authoritative either way — but
-- a stale fallback would promise 5 and pay 2, which reads as a bug.
update public.app_config
   set value = jsonb_set(
         value,
         '{gems,adGrant}',
         jsonb_build_object('amount', 2, 'dailyCap', 5)
       ),
       updated_at = now()
 where key = 'default';
