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
