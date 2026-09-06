/**
 * What the Remove Ads offer shows, and whether it shows at all.
 *
 * Same rule as lib/gemPricing.ts about money: the only figure we may print is
 * the store's own localized `priceString`, because Apple and Play set a
 * different price per storefront and quoting one we weren't charged is both
 * wrong for most of the world and an App Review rejection.
 *
 * What is different here is the OWNED state, and it carries most of the value
 * of this file. A non-consumable that is already owned must not present a Buy
 * button: the store rejects the second purchase with an error rather than a
 * cancel, so the player taps, waits, and is told something went wrong — for a
 * thing they already paid for. Once owned, the offer becomes a receipt.
 */

export type RemoveAdsView =
  /** Owned. No price, no tap — this is a confirmation, not an offer. */
  | { kind: "owned" }
  /** Buyable, with the store's own price string. */
  | { kind: "offer"; price: string }
  /** Visible but not actionable, with the reason in `label`. */
  | { kind: "blocked"; label: string }
  /** Not shown at all. */
  | { kind: "hidden" };

export function removeAdsView(opts: {
  /** ads.removeAds.enabled — the kill switch for the OFFER only. */
  offerEnabled: boolean;
  /** Does the player already have it (server grant or restore)? */
  owned: boolean;
  /** Whether the RevenueCat SDK configured (a build with a platform key). */
  storeConfigured: boolean;
  /** The store's localized price string for the product, once known. */
  storePrice?: string;
  /** Whether the product fetch has come back (success or failure). */
  priceLoaded: boolean;
}): RemoveAdsView {
  const { offerEnabled, owned, storeConfigured, storePrice, priceLoaded } = opts;

  // Owned outranks every other consideration, the kill switch included. Turning
  // the offer off must never take the receipt away from someone who bought it —
  // that reads as the purchase having been lost.
  if (owned) return { kind: "owned" };

  if (!offerEnabled) return { kind: "hidden" };
  // No billing SDK in this build. Unlike gem packs there is no server stub to
  // fall back on — an entitlement can only be granted by a validated receipt —
  // so there is nothing to offer even in dev.
  if (!storeConfigured) return { kind: "hidden" };

  if (storePrice) return { kind: "offer", price: storePrice };
  return priceLoaded
    ? { kind: "blocked", label: "Unavailable" }
    : { kind: "blocked", label: "…" };
}
