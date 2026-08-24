/**
 * Where bottom sheets actually get rendered.
 *
 * A sheet is declared next to the state that opens it — the Shop's buy sheet
 * inside CosmeticsBrowser, the gem store inside whichever row offered it. That
 * is the right place to WRITE one and the wrong place to DRAW one: React Native
 * has no `position: fixed`, so an absolutely positioned overlay is laid out
 * against its parent's box. Declared inside a ScrollView's content, the Shop's
 * buy sheet anchored itself to the bottom of the scrolling column — a screen
 * and a half down — so confirming a purchase meant scrolling to find the
 * confirm button, with the tab dock painting over what was left of it.
 *
 * So Sheet publishes its card here instead, and one host mounted at the app
 * root (above the screens AND the floating dock) renders whatever is in the
 * list. Declaration site and paint site come apart: a sheet lands on the
 * screen no matter how deep in the tree it was written.
 *
 * Order is the whole contract. Entries paint in the order they were presented,
 * and a re-render updates a card in place rather than moving it — reordering
 * would remount the card and restart its slide-in halfway through its life.
 */

import { create } from "zustand";
import type { ReactNode } from "react";

export interface MountedSheet {
  /** Stable per Sheet instance (React's useId). */
  id: string;
  node: ReactNode;
}

interface SheetHostState {
  /** Open sheets, back to front. */
  sheets: MountedSheet[];
  /** Mount a sheet's card, or refresh one already mounted. */
  present: (id: string, node: ReactNode) => void;
  /** Take it back down. Unknown ids are ignored — a cleanup can outlive a reset. */
  dismiss: (id: string) => void;
}

export const useSheetHost = create<SheetHostState>((set) => ({
  sheets: [],

  present: (id, node) =>
    set((s) => {
      const at = s.sheets.findIndex((entry) => entry.id === id);
      if (at === -1) return { sheets: [...s.sheets, { id, node }] };
      const sheets = s.sheets.slice();
      sheets[at] = { id, node };
      return { sheets };
    }),

  dismiss: (id) =>
    set((s) => (s.sheets.some((entry) => entry.id === id) ? { sheets: s.sheets.filter((e) => e.id !== id) } : s)),
}));
