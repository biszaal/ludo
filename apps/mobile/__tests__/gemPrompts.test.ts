/**
 * The wording of the two gem confirmations. Pinned in tests because these are
 * the last words a player reads before money or an irreversible trade — and
 * because there is no renderer here, so the copy is untestable anywhere else.
 */

import { describe, it, expect } from "vitest";
import { buyGemsPrompt, exchangeGemsPrompt } from "../src/lib/gemPrompts";

describe("buyGemsPrompt", () => {
  it("names the pack and the exact price that will be charged", () => {
    const p = buyGemsPrompt(340, "$4.99");
    expect(p.title).toBe("Buy 340 gems?");
    expect(p.message).toBe("You'll be charged $4.99.");
    expect(p.confirmLabel).toBe("Buy");
  });

  it("passes the store's own price string through untouched", () => {
    // Localized store prices are not always dollars, and Apple requires the
    // real charged figure — so this must never be reformatted.
    expect(buyGemsPrompt(60, "₹89.00").message).toBe("You'll be charged ₹89.00.");
  });

  it("promises no figure when the store hasn't given us one", () => {
    // The dev-stub path has no store price. Better to say the store will show
    // it than to quote a USD amount the player would never be charged.
    const p = buyGemsPrompt(60);
    expect(p.message).toBe("The store will show the price before you're charged.");
    expect(p.message).not.toMatch(/[$£€₹¥]/);
  });

  it("is not styled as destructive — buying loses nothing", () => {
    expect(buyGemsPrompt(60, "$0.99").destructive).toBeFalsy();
  });
});

describe("exchangeGemsPrompt", () => {
  it("says what you get and that it cannot be undone", () => {
    const p = exchangeGemsPrompt(50, 500);
    expect(p.title).toBe("Exchange 50 gems?");
    expect(p.message).toBe("You'll get 500 coins. One-way — gems never come back.");
    expect(p.confirmLabel).toBe("Exchange");
  });

  it("spells the coin total out in full rather than rounding it down", () => {
    // The row shows a compact "1K"; a confirmation should not round money.
    expect(exchangeGemsPrompt(100, 1000).message).toContain("1,000 coins");
  });

  it("keeps the singular when a single gem is traded", () => {
    expect(exchangeGemsPrompt(1, 10).title).toBe("Exchange 1 gem?");
  });
});
