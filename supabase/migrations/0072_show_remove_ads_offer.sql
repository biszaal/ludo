-- Show the Remove Ads offer again (operator decision, 2026-09-20).
--
-- The exact reverse of 0064, which switched it off "for now" and said so: the
-- product, the webhook and the client ad gate were left wired the whole time,
-- so there is nothing to rebuild or re-enable beyond this one flag.
--
-- `ads.removeAds.enabled` is the kill switch for the OFFER alone. It never
-- governed whether ads show, and it never took a receipt away — removeAdsView
-- ranks `owned` above the switch precisely so that turning the offer off could
-- not read as a lost purchase. Turning it back on therefore changes exactly
-- one thing: the Shop renders the card again.
--
-- This takes effect on EVERY INSTALLED BUILD the moment it lands, not just on
-- the next release — 0064's own note relies on that, and it is why the offer
-- could be pulled without shipping anything. So the offer returns for players
-- on 1.1.x at the same time as for players on 1.2.0.
--
-- Only `enabled` is written, for 0064's reason: rc-webhook also reads
-- `ads.removeAds.productId`, and leaving it absent keeps both sides on their
-- own defaults rather than pinning a product id in two places.
update public.app_config
   set value = jsonb_set(value, '{ads,removeAds,enabled}', 'true'::jsonb),
       updated_at = now()
 where key = 'default';
