/**
 * Remove Ads: who sees the offer, and who stops seeing ads.
 *
 * Both halves are the same promise from opposite sides. Showing a Buy button
 * to someone who already owns the product ends in a store error about a thing
 * they paid for; showing an ad to someone who owns it is the purchase visibly
 * not working. Neither is recoverable by the player, so both are pinned here.
 */

import { describe, expect, it, vi } from "vitest";

// Same stub every store test here uses: the real net/api module does not parse
// under vitest, and none of these assertions goes near the network.
vi.mock("../src/net/api", () => ({ getEntitlements: vi.fn(), shopBuy: vi.fn() }));

import { removeAdsView } from "../src/lib/removeAdsView";
import { noAdsActive } from "../src/store/entitlementsStore";

const SELLABLE = {
  offerEnabled: true,
  owned: false,
  storeConfigured: true,
  storePrice: "£2.99",
  priceLoaded: true,
};

describe("removeAdsView", () => {
  it("offers the product at the store's own price", () => {
    expect(removeAdsView(SELLABLE)).toEqual({ kind: "offer", price: "£2.99" });
  });

  it("never prints a price we did not get from the store", () => {
    // The whole reason this is a view model. A hardcoded fallback price would
    // be wrong in most storefronts and is an App Review rejection.
    const loading = removeAdsView({ ...SELLABLE, storePrice: undefined, priceLoaded: false });
    const failed = removeAdsView({ ...SELLABLE, storePrice: undefined, priceLoaded: true });
    expect(loading).toEqual({ kind: "blocked", label: "…" });
    expect(failed).toEqual({ kind: "blocked", label: "Unavailable" });
  });

  it("shows a receipt, not an offer, once owned", () => {
    expect(removeAdsView({ ...SELLABLE, owned: true })).toEqual({ kind: "owned" });
  });

  it("keeps showing the receipt even when the offer is switched off", () => {
    // Turning the offer off must never look like the purchase was lost.
    expect(removeAdsView({ ...SELLABLE, owned: true, offerEnabled: false })).toEqual({ kind: "owned" });
  });

  it("hides the offer with no billing SDK", () => {
    // Unlike gem packs there is no server stub: an entitlement needs a real
    // validated receipt, so there is nothing to offer even in a dev build.
    expect(removeAdsView({ ...SELLABLE, storeConfigured: false })).toEqual({ kind: "hidden" });
  });

  it("hides the offer when config turns it off", () => {
    expect(removeAdsView({ ...SELLABLE, offerEnabled: false })).toEqual({ kind: "hidden" });
  });
});

describe("noAdsActive", () => {
  it("is false for a player who has bought nothing", () => {
    expect(noAdsActive([], false)).toBe(false);
    expect(noAdsActive(["theme.night", "dice.gold"], false)).toBe(false);
  });

  it("honours the durable server grant", () => {
    expect(noAdsActive(["noads"], false)).toBe(true);
  });

  it("honours a restore with no server row yet", () => {
    // The reinstall-onto-a-fresh-guest case: a real receipt, no entitlement
    // row under this user id, and nothing server-side that could make one.
    expect(noAdsActive([], true)).toBe(true);
  });

  it("stays on when both agree", () => {
    expect(noAdsActive(["noads"], true)).toBe(true);
  });
});
