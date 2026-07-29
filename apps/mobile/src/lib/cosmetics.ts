/**
 * The cosmetics catalog, unified across the three purchasable kinds (avatars,
 * board themes, dice skins) so one browser can drive the Shop (buy) and the
 * Customize locker (equip owned). Pure data — the equip setters and the Skia
 * previews live in the components; this only says WHAT exists and WHICH sku
 * backs each item, so it stays testable in Node (no Skia imports).
 */

import { AVATARS } from "../render/avatars";
import { BOARD_THEMES } from "../render/boardThemes";
import { DICE_SKINS } from "../render/diceSkins";
import { avatarSku, diceSku, isUnlocked, themeSku } from "../store/entitlementsStore";

export type CosmeticCategory = "avatar" | "board" | "dice";

export interface CosmeticItem {
  id: string;
  /** Entitlement sku (`avatar.leo` / `theme.night` / `dice.gold`). */
  sku: string;
  label: string;
}

/** Every item in a category, in the catalog's own (cheap→prestige) order. */
export function cosmeticItems(category: CosmeticCategory): CosmeticItem[] {
  switch (category) {
    case "avatar":
      // Avatars have no display label of their own; the id doubles as one.
      return AVATARS.map((a) => ({ id: a.id, sku: avatarSku(a.id), label: a.id }));
    case "board":
      return Object.values(BOARD_THEMES).map((t) => ({ id: t.id, sku: themeSku(t.id), label: t.label }));
    case "dice":
      return Object.values(DICE_SKINS).map((s) => ({ id: s.id, sku: diceSku(s.id), label: s.label }));
  }
}

/** The owned subset — free items count as owned. Drives the Customize locker. */
export function ownedItems(
  category: CosmeticCategory,
  owned: string[],
  prices: Record<string, number>,
): CosmeticItem[] {
  return cosmeticItems(category).filter((it) => isUnlocked(owned, prices, it.sku));
}
