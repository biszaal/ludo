import { describe, it, expect, vi } from "vitest";

// The catalog pulls sku helpers from the entitlements store, which imports the
// network layer; stub it so this stays a pure data test (no Supabase client).
vi.mock("../src/net/api", () => ({}));

import { cosmeticItems, ownedItems, sellableItems } from "../src/lib/cosmetics";
import { AVATAR_IDS } from "../src/render/avatars";
import { BOARD_THEMES } from "../src/render/boardThemes";
import { DICE_SKINS } from "../src/render/diceSkins";

describe("cosmeticItems", () => {
  it("lists every avatar with an avatar.* sku, in catalog order", () => {
    const items = cosmeticItems("avatar");
    expect(items).toHaveLength(AVATAR_IDS.length);
    expect(items.map((i) => i.id)).toEqual([...AVATAR_IDS]);
    expect(items.every((i) => i.sku === `avatar.${i.id}`)).toBe(true);
  });

  it("lists every board theme with a theme.* sku and its label", () => {
    const items = cosmeticItems("board");
    expect(items).toHaveLength(Object.keys(BOARD_THEMES).length);
    expect(items.every((i) => i.sku === `theme.${i.id}`)).toBe(true);
    expect(items.find((i) => i.id === "night")?.label).toBe(BOARD_THEMES.night.label);
  });

  it("lists every dice skin with a dice.* sku", () => {
    const items = cosmeticItems("dice");
    expect(items).toHaveLength(Object.keys(DICE_SKINS).length);
    expect(items.every((i) => i.sku === `dice.${i.id}`)).toBe(true);
  });
});

describe("sellableItems", () => {
  it("hides what the catalog cannot sell", () => {
    // The shop used to list the whole client registry. A skin whose catalog row
    // has not been seeded yet then rendered as a tile priced 0 — a Buy button
    // the server rejects. Nothing to sell means nothing to show.
    const prices = { "dice.classic": 0, "dice.cherry": 400 };
    const ids = sellableItems("dice", [], prices).map((i) => i.id);
    expect(ids).toContain("classic");
    expect(ids).toContain("cherry");
    expect(ids).not.toContain("sovereign");
  });

  it("keeps an owned item even after it leaves the catalog", () => {
    const ids = sellableItems("dice", ["dice.sovereign"], { "dice.classic": 0 }).map((i) => i.id);
    expect(ids).toContain("sovereign");
  });

  it("shows the whole tier once its rows are seeded", () => {
    const prices = Object.fromEntries(cosmeticItems("dice").map((i) => [i.sku, 500]));
    expect(sellableItems("dice", [], prices)).toHaveLength(cosmeticItems("dice").length);
  });
});

describe("ownedItems", () => {
  it("keeps free and owned items, drops priced-unowned ones", () => {
    // classic carries a real price-0 row (0014_dice_skins.sql seeds it); this
    // fixture used to omit it and lean on "absent means free", which is exactly
    // the fail-open that gave away the unseeded gem tier. Free now has to be
    // stated, the way the server states it.
    const prices = { "dice.classic": 0, "dice.gold": 8000, "dice.cherry": 400 };
    const owned = ["dice.cherry"];
    const ids = ownedItems("dice", owned, prices).map((i) => i.id);
    expect(ids).toContain("classic"); // free (price 0 in the catalog)
    expect(ids).toContain("cherry"); // owned
    expect(ids).not.toContain("gold"); // priced, not owned
  });

  it("returns only free items when nothing is owned", () => {
    const prices = Object.fromEntries(
      cosmeticItems("dice").map((i) => [i.sku, i.id === "classic" ? 0 : 500]),
    );
    const ids = ownedItems("dice", [], prices).map((i) => i.id);
    expect(ids).toEqual(["classic"]);
  });
});
