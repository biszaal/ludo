-- Retune the rewarded-gem drip: 5 gems a view, 5 views a day.
--
-- 0027 sized this as a deliberate trickle — 1 gem once a day, ~30/month against
-- a 60-gem $0.99 pack — so that gems stayed worth buying. This is an operator
-- decision to open it up by 25x (5 x 5 = 25/day, ~750/month, i.e. more than the
-- 750-gem $9.99 pack every month for free).
--
-- Recorded plainly because it is not a small change: at this rate the ad path,
-- not the store, becomes how a committed player gets gems, and the pack prices
-- in `gems.products` almost certainly want revisiting to match. Both numbers
-- stay in config precisely so this can be walked back without a store release.
--
-- FAIRNESS INVARIANT (0013, 0018, 0027) is untouched and non-negotiable: gems
-- buy ACCESS and APPEARANCE. A player with 750 gems a month has nicer pawns and
-- no better chance of winning a single match.
--
-- Unconditional, unlike 0027's `not (value ? 'adGrant')` guard — that one was
-- seeding a key that did not exist yet. This one is changing a key that does.
update public.app_config
   set value = jsonb_set(
         value,
         '{gems,adGrant}',
         jsonb_build_object('amount', 5, 'dailyCap', 5)
       ),
       updated_at = now()
 where key = 'default';
