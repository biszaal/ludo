-- Hide the Remove Ads offer for now (operator decision, 2026-09-16).
--
-- The product stays wired end to end (0063, rc-webhook, the client ad gate);
-- only the Shop's offer is switched off. `ads.removeAds.enabled` is the kill
-- switch for the OFFER alone: anyone who owns Remove Ads still sees their
-- receipt and Restore button, and ads stay off for them. Nobody owned it when
-- this was written (0 `noads` entitlements), so nothing is taken from a buyer.
--
-- The key was never seeded, so clients fell back to their built-in default
-- (enabled: true). jsonb_set creates it. Only `enabled` is written: rc-webhook
-- also reads `ads.removeAds.productId`, and leaving it absent keeps both sides
-- on their own defaults. Setting `enabled` back to true brings the offer back on
-- every installed build without a release.
update public.app_config
   set value = jsonb_set(value, '{ads,removeAds}', jsonb_build_object('enabled', false)),
       updated_at = now()
 where key = 'default';
