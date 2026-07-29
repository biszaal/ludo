import { describe, it, expect, vi } from "vitest";

// The catalog pulls sku helpers from the entitlements store, which imports the
// network layer; stub it so this stays a pure data test (no Supabase client).
vi.mock("../src/net/api", () => ({}));

import { cosmeticItems, ownedItems } from "../src/lib/cosmetics";
import { AVATARS } from "../src/render/avatars";
import { BOARD_THEMES } from "../src/render/boardThemes";
import { DICE_SKINS } from "../src/render/diceSkins";

describe("cosmeticItems", () => {
  it("lists every avatar with an avatar.* sku, in catalog order", () => {
    const items = cosmeticItems("avatar");
    expect(items).toHaveLength(AVATARS.length);
    expect(items.map((i) => i.id)).toEqual(AVATARS.map((a) => a.id));
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

describe("ownedItems", () => {
  it("keeps free and owned items, drops priced-unowned ones", () => {
    const prices = { "dice.gold": 8000, "dice.cherry": 400 };
    const owned = ["dice.cherry"];
    const ids = ownedItems("dice", owned, prices).map((i) => i.id);
    expect(ids).toContain("classic"); // free (no price row)
    expect(ids).toContain("cherry"); // owned
    expect(ids).not.toContain("gold"); // priced, not owned
  });

  it("returns only free items when nothing is owned", () => {
    const prices = Object.fromEntries(
      cosmeticItems("dice")
        .filter((i) => i.id !== "classic")
        .map((i) => [i.sku, 500]),
    );
    const ids = ownedItems("dice", [], prices).map((i) => i.id);
    expect(ids).toEqual(["classic"]);
  });
});
