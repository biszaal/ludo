/**
 * Which tab the Shop and Customize browsers are showing.
 *
 * Shared between the two screens (session-only, not persisted) so tapping
 * "Shop for more" on the Dice tab opens the Shop already on Dice — one
 * continuous browse. The gem pill leans on the same thing from Home: set the
 * tab, switch to Shop, and the player lands where they asked to go.
 *
 * `tab` and `category` are separate on purpose. Gems are not a cosmetic — the
 * Customize locker has no business showing them, and the hero preview has
 * nothing to draw for them — so `category` only ever holds a real cosmetic and
 * remembers the last one, which is what switching back off the Gems tab
 * returns to.
 */

import { create } from "zustand";
import type { CosmeticCategory } from "../lib/cosmetics";

/** Shop tabs: the three cosmetic kinds, plus where gems come from. */
export type ShopTab = CosmeticCategory | "gems";

interface CosmeticsUI {
  /** What the Shop is showing. */
  tab: ShopTab;
  /** The last real cosmetic category — never "gems". Drives the locker. */
  category: CosmeticCategory;
  setTab: (tab: ShopTab) => void;
  setCategory: (category: CosmeticCategory) => void;
}

export const useCosmeticsUI = create<CosmeticsUI>((set) => ({
  tab: "avatar",
  category: "avatar",
  setTab: (tab) => set(tab === "gems" ? { tab } : { tab, category: tab }),
  setCategory: (category) => set({ tab: category, category }),
}));
