-- Hide the Remove Ads offer again (operator decision, 2026-09-20).
--
-- 0072 turned it back on earlier the same day. That was premature: the feature
-- is not finished, and the flag is not a staging switch — `ads.removeAds`
-- takes effect on every installed build the moment it is written, so 0072 put
-- an unfinished offer in front of every live player on 1.1.x for the minutes
-- between the two. This puts it back where 0064 left it.
--
-- 0072 is left in place rather than deleted. It was applied to production, so
-- the ledger has to keep saying so; a migration that ran is not un-run by
-- removing the file, and a revert that hides its own mistake is worse than the
-- mistake. Read 0064 -> 0072 -> 0073 as what actually happened.
--
-- Unchanged by any of this: nobody's receipt. removeAdsView ranks `owned`
-- above the switch, so an owner keeps their confirmation and their Restore
-- button, and ads stay off for them, whichever way the flag points. The
-- product, webhook and ad gate stay wired; only the Shop card goes away.
--
-- When the feature IS finished, the offer comes back with a one-line config
-- migration and no release, exactly as it did here.
update public.app_config
   set value = jsonb_set(value, '{ads,removeAds,enabled}', 'false'::jsonb),
       updated_at = now()
 where key = 'default';
