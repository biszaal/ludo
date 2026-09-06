-- Remove Ads becomes a real product.
--
-- The `noads` sku has existed since 0013 and has never done anything: the
-- catalog row was seeded inactive, and both ad gates in the app hardcoded
-- `entitled = false` behind a TODO. So the one purchase a player most often
-- wants to make in a free game was the one thing they could not buy — while
-- a player who DID pay us, for gems, kept seeing ads anyway.
--
-- It is sold for money rather than for coins or gems, deliberately. Coins and
-- gems are earned currency; spending them removes ads for someone who never
-- paid, which turns an ad-supported player into a non-earning one. Money is
-- also what makes the trade honest in both directions — the player stops
-- seeing ads, and we stop needing them to.
--
-- The grant path is the one that already exists for gems: RevenueCat validates
-- the receipt, calls rc-webhook, and the WEBHOOK writes the entitlement row.
-- The client never grants itself anything (0018/0055).
--
-- Only one schema change is needed for that, below. The catalog row stays
-- inactive on purpose: opShopBuy is the coins/gems counter, and an active row
-- there would offer Remove Ads for coins, which is exactly what the paragraph
-- above rules out. It refuses by construction rather than by remembering.

-- iap_purchases is the audit trail for money, and it was written when money
-- only ever bought gems — `check (gems > 0)` made "a purchase that credits no
-- gems" unrepresentable. A Remove Ads purchase is precisely that: real money,
-- zero gems, an entitlement instead.
--
-- Relaxed to >= 0 rather than dropped. Zero is now meaningful (this product),
-- but negative still is not, and the constraint is the only thing standing
-- between a webhook bug and a refund-shaped row in the money ledger.
alter table public.iap_purchases drop constraint if exists iap_purchases_gems_check;
alter table public.iap_purchases add constraint iap_purchases_gems_check check (gems >= 0);

-- The guest sweep (0054) spares any account holding a source = 'iap'
-- entitlement, so this grant also makes a paying guest un-sweepable. That is
-- the correct behaviour and it needs no change here — it is recorded because
-- it is the kind of interaction that is invisible until it deletes somebody
-- who paid.
