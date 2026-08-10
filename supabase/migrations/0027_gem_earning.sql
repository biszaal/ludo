-- Gems become earnable.
--
-- 0018 built the whole gem economy — balance, ledger, gem_apply, iap_purchases,
-- the premium cosmetics tier, the one-way exchange — and then shipped it with
-- purchasesEnabled = false and allowStubProvider = false. The net effect is a
-- premium currency NO player can obtain by any path, and a tier of cosmetics
-- nobody can ever buy. This opens three doors, in descending order of how most
-- gems should actually arrive:
--
--   1. Real money, through the store (RevenueCat -> rc-webhook -> gem_apply).
--   2. A slow rewarded-ad drip, hard-capped per day.
--   3. The daily streak finale.
--
-- Sizing, so the drip stays a drip: the ad path pays 1 gem once a day (~30/mo)
-- and the streak finale 5 (~21/mo). Against a 60-gem $0.99 pack and a 100-gem
-- cheapest premium cosmetic, a committed free player earns roughly one small
-- pack a month — enough that gems feel real, not so much that buying them
-- looks foolish. All four numbers live in config so they can be retuned
-- without a store release; the SERVER reads them on every grant, so a tampered
-- client config changes what is shown and never what is paid.
--
-- FAIRNESS INVARIANT (0013, 0018, unchanged): gems buy ACCESS and APPEARANCE.
-- Nothing here touches a match outcome — a rewarded gem buys a nicer pawn, and
-- that is the whole point of it being safe to sell.

-- 1. Rewarded ads can pay in gems ---------------------------------------------
-- ad_rewards.coins predates a second currency. Rather than rename it (the SSV
-- function reads this table and would break for in-flight rows mid-deploy), it
-- becomes "the amount", denominated by the new currency column.
alter table public.ad_rewards
  add column if not exists currency text not null default 'coins'
    check (currency in ('coins', 'gems'));

comment on column public.ad_rewards.coins is
  'Amount granted, denominated in `currency`. Named for the coins-only era.';

-- 2. Config ------------------------------------------------------------------
-- Real billing is live: the store path (client -> RevenueCat -> rc-webhook) is
-- what credits gems. allowStubProvider stays FALSE forever — it is the second
-- lock that stops opGemsBuy minting unpaid gems, and the real path never goes
-- near it.
update public.app_config
   set value = jsonb_set(value, '{gems,purchasesEnabled}', 'true'::jsonb),
       updated_at = now()
 where key = 'default';

-- The rewarded-gem drip. Server-owned amount and cap.
update public.app_config
   set value = jsonb_set(
         value,
         '{gems,adGrant}',
         jsonb_build_object('amount', 1, 'dailyCap', 1)
       ),
       updated_at = now()
 where key = 'default' and not (value -> 'gems' ? 'adGrant');

-- Streak finale. gemDay matches streakMaxDay (7) so the calendar's last cell
-- and the gem payout are the same moment; splitting them would need a reason.
update public.app_config
   set value = jsonb_set(value, '{economy,gemDay}', '7'::jsonb),
       updated_at = now()
 where key = 'default' and not (value -> 'economy' ? 'gemDay');

update public.app_config
   set value = jsonb_set(value, '{economy,gemAmount}', '5'::jsonb),
       updated_at = now()
 where key = 'default' and not (value -> 'economy' ? 'gemAmount');

-- The client mirrors this flag for display only (configStore.RewardedConfig).
update public.app_config
   set value = jsonb_set(value, '{ads,rewarded,gemGrant}', 'true'::jsonb),
       updated_at = now()
 where key = 'default' and not (value -> 'ads' -> 'rewarded' ? 'gemGrant');
