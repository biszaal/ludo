/**
 * Cosmetic ownership — the sink half of the coin economy.
 *
 * The important behaviours are the failure modes: a catalog we couldn't fetch
 * must never lock a player out of cosmetics they already have, and a rejected
 * purchase must not optimistically mark anything owned.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../src/net/api", () => ({
  getEntitlements: vi.fn(),
  shopBuy: vi.fn(),
}));

import * as api from "../src/net/api";
import {
  useEntitlements,
  isUnlocked,
  priceOf,
  themeSku,
  avatarSku,
  diceSku,
} from "../src/store/entitlementsStore";
import { useWallet } from "../src/store/walletStore";

afterEach(() => {
  useEntitlements.setState({ owned: [], prices: {}, loading: false, buying: null });
  useWallet.setState({ balance: null });
  vi.clearAllMocks();
});

describe("sku naming", () => {
  it("matches the catalog seed shape", () => {
    expect(themeSku("night")).toBe("theme.night");
    expect(avatarSku("zara")).toBe("avatar.zara");
    expect(diceSku("obsidian-king")).toBe("dice.obsidian-king");
  });
});

describe("isUnlocked", () => {
  const prices = { "theme.classic": 0, "theme.night": 600 };

  it("unlocks free items for everyone", () => {
    expect(isUnlocked([], prices, "theme.classic")).toBe(true);
  });

  it("locks priced items the player doesn't own", () => {
    expect(isUnlocked([], prices, "theme.night")).toBe(false);
  });

  it("unlocks a priced item once owned", () => {
    expect(isUnlocked(["theme.night"], prices, "theme.night")).toBe(true);
  });

  it("treats an unknown sku as free rather than locking it", () => {
    // A failed catalog fetch must not lock the player out of their own board.
    expect(isUnlocked([], {}, "theme.walnut")).toBe(true);
    expect(priceOf({}, "theme.walnut")).toBe(0);
  });
});

describe("refresh", () => {
  it("maps the catalog into a price lookup", async () => {
    vi.mocked(api.getEntitlements).mockResolvedValue({
      skus: ["avatar.rex"],
      catalog: [
        { sku: "theme.night", kind: "theme", price: 600, active: true },
        { sku: "avatar.rex", kind: "avatar", price: 300, active: true },
      ],
    });
    await useEntitlements.getState().refresh();
    expect(useEntitlements.getState().owned).toEqual(["avatar.rex"]);
    expect(useEntitlements.getState().prices["theme.night"]).toBe(600);
  });

  it("keeps the cached view when offline", async () => {
    useEntitlements.setState({ owned: ["theme.sand"], prices: { "theme.sand": 600 } });
    vi.mocked(api.getEntitlements).mockRejectedValue(new Error("offline"));
    await useEntitlements.getState().refresh();
    expect(useEntitlements.getState().owned).toEqual(["theme.sand"]);
    expect(useEntitlements.getState().loading).toBe(false);
  });
});

describe("buy", () => {
  it("records ownership and mirrors the server's new balance", async () => {
    useWallet.setState({ balance: 800 });
    vi.mocked(api.shopBuy).mockResolvedValue({ sku: "theme.night", balance: 200 });
    const err = await useEntitlements.getState().buy("theme.night");
    expect(err).toBeNull();
    expect(useEntitlements.getState().owned).toContain("theme.night");
    expect(useWallet.getState().balance).toBe(200);
  });

  it("surfaces the server's refusal and grants nothing", async () => {
    useWallet.setState({ balance: 10 });
    vi.mocked(api.shopBuy).mockRejectedValue(new Error("Not enough coins."));
    const err = await useEntitlements.getState().buy("theme.night");
    expect(err).toBe("Not enough coins.");
    expect(useEntitlements.getState().owned).not.toContain("theme.night");
    expect(useWallet.getState().balance).toBe(10);
    expect(useEntitlements.getState().buying).toBeNull();
  });

  it("ignores a second tap while a purchase is in flight", async () => {
    useEntitlements.setState({ buying: "theme.night" });
    await useEntitlements.getState().buy("theme.sand");
    expect(api.shopBuy).not.toHaveBeenCalled();
  });
});
