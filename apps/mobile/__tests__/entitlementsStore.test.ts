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
  inCatalog,
  isUnlocked,
  priceOf,
  themeSku,
  avatarSku,
  diceSku,
} from "../src/store/entitlementsStore";
import { useWallet } from "../src/store/walletStore";

afterEach(() => {
  useEntitlements.setState({ owned: [], prices: {}, loading: false, buying: null, failed: false });
  useWallet.setState({ balance: null });
  vi.clearAllMocks();
});

describe("a sku the catalog does not list", () => {
  // The bug this pins, found in the shop: every dice skin added client-side
  // before its catalog row was seeded showed up as OWNED and equippable, free.
  //
  // `prices` is built purely from the server catalog, and priceOf falls back to
  // 0 for anything absent — so "the server has never heard of this" and "the
  // server sells this for nothing" were the same value. isUnlocked then read
  // that 0 as free. The empty-catalog case was already guarded for exactly this
  // reason ("Unverifiable is not the same as free"); a single missing sku inside
  // a catalog we DID fetch went through the gap.
  //
  // This matters beyond one bad release: the client registry ships in an app
  // build and the catalog ships in a migration, so any skew between them hands
  // out the newest cosmetics for free until the migration lands.
  const catalog = { "dice.cherry": 400, "dice.classic": 0 };

  it("does not count as owned", () => {
    expect(isUnlocked([], catalog, "dice.sovereign")).toBe(false);
  });

  it("still counts as owned when the player actually owns it", () => {
    // Ownership is server-confirmed and outranks the catalog — a skin that was
    // bought and later delisted must stay equippable.
    expect(isUnlocked(["dice.sovereign"], catalog, "dice.sovereign")).toBe(true);
  });

  it("leaves genuinely free items free, and priced items locked", () => {
    expect(isUnlocked([], catalog, "dice.classic")).toBe(true);
    expect(isUnlocked([], catalog, "dice.cherry")).toBe(false);
  });

  it("is distinguishable from a free item, so the UI can decline to sell it", () => {
    expect(inCatalog(catalog, "dice.classic")).toBe(true);
    expect(inCatalog(catalog, "dice.sovereign")).toBe(false);
  });
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

  it("locks an unknown sku even in a KNOWN catalog", () => {
    // This used to assert the opposite, on the grounds that it mirrored
    // profiles_enforce_dice_skin, which lets an unpriced sku through "so a
    // client ahead of the seed still works".
    //
    // The mirror was the mistake. That trigger's stated worry is that an older
    // client must not have its whole profile write REJECTED — but its own
    // else-branch already handles that gracefully by nulling the skin, not by
    // failing the write. Forward-compat and free-access are separable, and
    // conflating them meant every cosmetic the client knew about before its
    // catalog row was seeded was free to equip. That is not a hypothetical:
    // the registry ships in an app build and the catalog ships in a migration,
    // so the two drift by construction on every release.
    //
    // The client is now stricter than the server, which is the safe direction:
    // it refuses to hand out something unverifiable, and nothing breaks if the
    // server later agrees.
    expect(isUnlocked([], prices, "theme.walnut")).toBe(false);
    // priceOf still answers 0 for an absent sku — that is why callers deciding
    // whether to SELL something must ask inCatalog, not priceOf.
    expect(priceOf({}, "theme.walnut")).toBe(0);
    expect(inCatalog(prices, "theme.walnut")).toBe(false);
  });

  it("offers nothing unowned before the catalog has loaded", () => {
    // The bug this closes: an empty price map read as "everything is free", so
    // the locker offered every dice skin. Equipping one looked fine locally and
    // was then silently stripped server-side — owner saw it, opponents didn't.
    expect(isUnlocked([], {}, "dice.gold")).toBe(false);
  });

  it("still never locks the player out of something they own", () => {
    // The original reason for being lenient — preserved where it matters.
    expect(isUnlocked(["dice.gold"], {}, "dice.gold")).toBe(true);
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

describe("a catalog fetch that fails", () => {
  it("records the failure so the shop can offer a retry", async () => {
    vi.mocked(api.getEntitlements).mockRejectedValueOnce(new Error("offline"));
    await useEntitlements.getState().refresh();
    expect(useEntitlements.getState().failed).toBe(true);
  });

  it("clears the failure once a later fetch lands", async () => {
    vi.mocked(api.getEntitlements).mockRejectedValueOnce(new Error("offline"));
    await useEntitlements.getState().refresh();

    vi.mocked(api.getEntitlements).mockResolvedValueOnce({
      skus: [],
      catalog: [{ sku: "avatar.leo", price: 0, currency: "coins" }],
    } as unknown as Awaited<ReturnType<typeof api.getEntitlements>>);
    await useEntitlements.getState().refresh();

    expect(useEntitlements.getState().failed).toBe(false);
    expect(useEntitlements.getState().prices["avatar.leo"]).toBe(0);
  });

  it("keeps the cached catalog when a refresh fails, so the shop still sells", async () => {
    useEntitlements.setState({ prices: { "avatar.leo": 0 }, owned: ["avatar.leo"] });
    vi.mocked(api.getEntitlements).mockRejectedValueOnce(new Error("offline"));
    await useEntitlements.getState().refresh();
    expect(useEntitlements.getState().prices["avatar.leo"]).toBe(0);
    expect(useEntitlements.getState().owned).toContain("avatar.leo");
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
