/**
 * RevenueCat client — buys the consumable gem packs, nothing else.
 *
 * The client never credits itself. RevenueCat validates the App Store / Play
 * receipt and, via the rc-webhook edge function, credits the gems server-side
 * (gem_apply). After a successful purchase the client just reconciles the
 * balance from the server (walletStore.buyGems polls for the credit).
 *
 * Kept import-light on purpose — only the RevenueCat SDK, no `react-native` or
 * Supabase imports — so the wallet store that depends on it still unit-tests in
 * Node. The platform API key and the user id are passed in by callers (App.tsx
 * / lib/auth), which are not under test.
 *
 * Guest-safe: purchases attach to the current Supabase user id via logIn, so
 * they follow the player through anonymous→saved account linking (the id is
 * stable). With no API key (billing not wired for a build) everything no-ops
 * and callers fall back to the server stub.
 */

import Purchases, { LOG_LEVEL, PURCHASE_TYPE, type PurchasesStoreProduct } from "react-native-purchases";

let configured = false;

/** True once the SDK is live. When false, callers use the server-stub path. */
export function isPurchasesConfigured(): boolean {
  return configured;
}

/** Configure the SDK once with the platform's public key. A missing key
 *  (billing not wired for this build) simply no-ops. */
export async function initPurchases(apiKey?: string | null): Promise<void> {
  if (configured || !apiKey) return;
  try {
    if (typeof __DEV__ !== "undefined" && __DEV__) Purchases.setLogLevel(LOG_LEVEL.VERBOSE);
    Purchases.configure({ apiKey });
    configured = true;
  } catch {
    configured = false; // leave callers on the server-stub path
  }
}

/** Attach RevenueCat to a Supabase user (at launch, and after sign-in /
 *  linking) so purchases attribute to the right account. No-op until configured. */
export async function syncPurchasesUser(userId: string | null): Promise<void> {
  if (!configured || !userId) return;
  try {
    await Purchases.logIn(userId);
  } catch {
    // non-fatal — attribution retries on the next logIn
  }
}

/** The gem-pack products with the store's localized prices, keyed by product
 *  id. Use `.priceString` for display (never a hardcoded currency amount). */
export async function getGemProducts(ids: string[]): Promise<Record<string, PurchasesStoreProduct>> {
  if (!configured || ids.length === 0) return {};
  try {
    const products = await Purchases.getProducts(ids, PURCHASE_TYPE.INAPP);
    const map: Record<string, PurchasesStoreProduct> = {};
    for (const p of products) map[p.identifier] = p;
    return map;
  } catch {
    return {};
  }
}

export type GemPurchaseOutcome = "success" | "cancelled" | "unavailable" | "error";

/**
 * The RevenueCat entitlement identifier for Remove Ads.
 *
 * Same string as the Supabase entitlements sku (0013) and as the server's
 * REMOVE_ADS_SKU, and the three have to agree. Configured in the RevenueCat
 * dashboard as an entitlement of this name attached to the Remove Ads product.
 */
export const NO_ADS_ENTITLEMENT = "noads";

/**
 * Does RevenueCat believe this player owns Remove Ads right now?
 *
 * This is the RESTORE path, and it is why the ad gate consults RevenueCat at
 * all rather than trusting the server row alone. The durable grant is written
 * by rc-webhook against the Supabase user id that made the purchase; a player
 * who reinstalls and lands on a fresh anonymous account has no such row, and
 * no receipt we could check server-side either. RevenueCat does have the
 * receipt, and `restorePurchases` moves the purchase onto the current id — so
 * asking it is the only thing that can answer immediately and offline.
 *
 * Trusting a client answer is acceptable HERE and nowhere near currency: the
 * worst a forged `true` achieves is hiding ads from the forger. It cannot move
 * coins, gems, or a match outcome, which is the line the 0018 fairness
 * invariant actually draws.
 */
export async function hasNoAdsEntitlement(): Promise<boolean> {
  if (!configured) return false;
  try {
    const info = await Purchases.getCustomerInfo();
    return info.entitlements.active[NO_ADS_ENTITLEMENT] !== undefined;
  } catch {
    return false; // unknown reads as "not entitled" — ads stay on, nobody is charged
  }
}

/**
 * Buy a non-consumable (Remove Ads).
 *
 * Separate from purchaseGemProduct despite the near-identical body, because
 * the two differ in the one way that matters afterwards: a gem pack is
 * consumable and can be bought again, this cannot. Apple rejects a second
 * purchase of an owned non-consumable with an "already purchased" error rather
 * than a cancel, which is why `owned` exists as its own outcome — the caller
 * has to treat it as success (restore the entitlement) rather than as failure.
 */
export type NoAdsPurchaseOutcome = GemPurchaseOutcome | "owned";

export async function purchaseNoAds(productId: string): Promise<NoAdsPurchaseOutcome> {
  if (!configured) return "unavailable";
  try {
    const [product] = await Purchases.getProducts([productId], PURCHASE_TYPE.INAPP);
    if (!product) return "unavailable";
    const { customerInfo } = await Purchases.purchaseStoreProduct(product);
    return customerInfo.entitlements.active[NO_ADS_ENTITLEMENT] !== undefined ? "success" : "error";
  } catch (e) {
    const err = e as { userCancelled?: boolean | null; code?: string | number | null };
    if (err?.userCancelled) return "cancelled";
    // PURCHASE_NOT_ALLOWED / PRODUCT_ALREADY_PURCHASED both mean "you have this
    // already" from the player's point of view. Let restore sort it out.
    if (await hasNoAdsEntitlement()) return "owned";
    return "error";
  }
}

/** The Remove Ads product, for its localized `priceString`. Never display a
 *  hardcoded amount — the store sets a different price per storefront. */
export async function getNoAdsProduct(productId: string): Promise<PurchasesStoreProduct | null> {
  if (!configured) return null;
  try {
    const [product] = await Purchases.getProducts([productId], PURCHASE_TYPE.INAPP);
    return product ?? null;
  } catch {
    return null;
  }
}

/**
 * Restore previous purchases.
 *
 * Required by App Review for any non-consumable, and genuinely needed: a
 * player who reinstalls, or who bought as a guest and later signed in, has a
 * receipt with no matching entitlement row. Restoring re-attaches the purchase
 * to the current RevenueCat app_user_id (which IS the Supabase user id), and
 * the resulting event re-grants server-side.
 *
 * Returns whether Remove Ads came back, so the caller can tell "restored" from
 * "nothing to restore" — two outcomes that need different words on screen.
 */
export async function restorePurchases(): Promise<boolean> {
  if (!configured) return false;
  try {
    const info = await Purchases.restorePurchases();
    return info.entitlements.active[NO_ADS_ENTITLEMENT] !== undefined;
  } catch {
    return false;
  }
}

/** Run the store purchase for a gem pack. On "success" the money is captured
 *  and RevenueCat will credit the gems via the webhook — the caller reconciles
 *  the balance from the server. "cancelled" is the user backing out (no error). */
export async function purchaseGemProduct(productId: string): Promise<GemPurchaseOutcome> {
  if (!configured) return "unavailable";
  try {
    const [product] = await Purchases.getProducts([productId], PURCHASE_TYPE.INAPP);
    if (!product) return "unavailable";
    await Purchases.purchaseStoreProduct(product);
    return "success";
  } catch (e) {
    if ((e as { userCancelled?: boolean | null })?.userCancelled) return "cancelled";
    return "error";
  }
}
