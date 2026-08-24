/**
 * What a gem pack row shows where a price goes.
 *
 * The only currency figure we are ever allowed to print is the store's own
 * localized `priceString`. Apple (and Play) set a different price per
 * storefront — ₹89, £0.99, ¥160 — and pick it automatically from the
 * customer's account region, so a hardcoded dollar amount is simply wrong for
 * most of the world, and quoting a price that isn't the one charged is an App
 * Review rejection. The priceUsd carried per product in the remote config is
 * bookkeeping for the tier, never something a player sees.
 *
 * So when the real figure isn't in hand, the row says so and refuses the tap
 * rather than guessing. That also matches what would happen anyway: without
 * loaded products the purchase itself cannot start.
 */

export type GemPriceView = {
  /** Row subtitle. A store price string, or a reason there is no price. */
  label: string;
  /** Whether the row may be tapped to start a purchase. */
  buyable: boolean;
};

export function gemPriceView(opts: {
  /** gems.purchasesEnabled from remote config — the public billing flag. */
  purchasesEnabled: boolean;
  /** Whether the RevenueCat SDK configured (a build with a platform key). */
  storeConfigured: boolean;
  /** The store's localized price string for this product, once known. */
  storePrice?: string;
  /** Whether the products fetch has come back (success or failure). */
  pricesLoaded: boolean;
  /** __DEV__. Only a dev build may buy through the server stub. */
  dev: boolean;
}): GemPriceView {
  const { purchasesEnabled, storeConfigured, storePrice, pricesLoaded, dev } = opts;

  if (!purchasesEnabled) return { label: "Coming soon", buyable: false };

  // No SDK in this build: the server stub is the only path, and it is
  // double-locked server-side. Offer it in dev; in a shipped build there is no
  // price to show and nothing that could succeed, so say it plainly.
  if (!storeConfigured) {
    return dev ? { label: "Test purchase", buyable: true } : { label: "Unavailable", buyable: false };
  }

  if (storePrice) return { label: storePrice, buyable: true };
  return pricesLoaded ? { label: "Unavailable", buyable: false } : { label: "…", buyable: false };
}
