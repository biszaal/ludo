/**
 * Which cosmetic category (Avatar / Board / Dice) the Shop and Customize
 * browsers are showing. Shared between the two screens (session-only, not
 * persisted) so tapping "Shop for more" on the Dice tab opens the Shop already
 * on Dice — one continuous browse.
 */

import { create } from "zustand";
import type { CosmeticCategory } from "../lib/cosmetics";

interface CosmeticsUI {
  category: CosmeticCategory;
  setCategory: (category: CosmeticCategory) => void;
}

export const useCosmeticsUI = create<CosmeticsUI>((set) => ({
  category: "avatar",
  setCategory: (category) => set({ category }),
}));
