/**
 * The cosmetics catalog, unified across the three purchasable kinds (avatars,
 * board themes, dice skins) so one browser can drive the Shop (buy) and the
 * Customize locker (equip owned). Pure data — the equip setters and the Skia
 * previews live in the components; this only says WHAT exists and WHICH sku
 * backs each item, so it stays testable in Node (no Skia imports).
 */

import { AVATAR_IDS } from "../render/avatars";
import { BOARD_THEMES } from "../render/boardThemes";
import { DICE_SKINS } from "../render/diceSkins";
import { avatarSku, diceSku, inCatalog, isUnlocked, themeSku } from "../store/entitlementsStore";

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
      return AVATAR_IDS.map((id) => ({ id, sku: avatarSku(id), label: id }));
    case "board":
      return Object.values(BOARD_THEMES).map((t) => ({ id: t.id, sku: themeSku(t.id), label: t.label }));
    case "dice":
      return Object.values(DICE_SKINS).map((s) => ({ id: s.id, sku: diceSku(s.id), label: s.label }));
  }
}

/**
 * The subset the shop may actually offer: everything the server's catalog
 * lists, plus anything already owned.
 *
 * Without this the shop grid renders the whole CLIENT registry, and a skin the
 * catalog has never heard of comes out as a tile priced 0 in coins — a Buy
 * button the server refuses. That is the visible half of the same fail-open
 * that used to mark those skins Owned outright (see isUnlocked): a cosmetic
 * ships in an app build, its catalog row ships in a migration, and between the
 * two there is a window where the client knows about something unsellable.
 * Nothing to sell means nothing to show.
 *
 * Owned items stay regardless, so a skin that is later delisted does not
 * vanish from under the player who bought it.
 */
export function sellableItems(
  category: CosmeticCategory,
  owned: string[],
  prices: Record<string, number>,
): CosmeticItem[] {
  return cosmeticItems(category).filter((it) => inCatalog(prices, it.sku) || owned.includes(it.sku));
}

/** The owned subset — free items count as owned. Drives the Customize locker. */
export function ownedItems(
  category: CosmeticCategory,
  owned: string[],
  prices: Record<string, number>,
): CosmeticItem[] {
  return cosmeticItems(category).filter((it) => isUnlocked(owned, prices, it.sku));
}
