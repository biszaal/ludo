/**
 * App navigation — a single typed screen stack rendered by ScreenStack. Stores
 * navigate imperatively (useNav.getState().push(...)); screens never mount two
 * game surfaces at once because only the top entry renders.
 *
 * Screens needing custom Android back behavior (pause menu, leave-room cleanup)
 * register a back interceptor; ScreenStack consults it before popping.
 */

import { create } from "zustand";

export type ScreenName = "home" | "localGame" | "lobby" | "onlineGame" | "settings" | "profile" | "shop" | "howToPlay" | "account" | "friends" | "addFriend" | "playerProfile";

export interface NavEntry {
  name: ScreenName;
  /** Unique per push, so re-visiting a screen still remounts + animates. */
  key: string;
}

type NavOp = "push" | "pop" | "reset";

interface NavStore {
  stack: NavEntry[];
  /** What produced the current stack — drives the transition direction. */
  lastOp: NavOp;
  push: (name: ScreenName) => void;
  /** Swap the top entry (e.g. lobby → onlineGame so back never returns to a dead lobby). */
  replace: (name: ScreenName) => void;
  /** Remove the top entry; no-op at the root. */
  pop: () => void;
  /** Pop back to the nearest entry with this name; resets to it if absent. */
  popTo: (name: ScreenName) => void;
  reset: (name: ScreenName) => void;
}

let keyCounter = 0;
function entry(name: ScreenName): NavEntry {
  return { name, key: `${name}-${++keyCounter}` };
}

export const useNav = create<NavStore>((set, get) => ({
  stack: [entry("home")],
  lastOp: "reset",

  push: (name) => set({ stack: [...get().stack, entry(name)], lastOp: "push" }),

  replace: (name) => set({ stack: [...get().stack.slice(0, -1), entry(name)], lastOp: "push" }),

  pop: () => {
    const { stack } = get();
    if (stack.length <= 1) return;
    set({ stack: stack.slice(0, -1), lastOp: "pop" });
  },

  popTo: (name) => {
    const { stack } = get();
    const idx = stack.map((e) => e.name).lastIndexOf(name);
    if (idx === -1) {
      set({ stack: [entry(name)], lastOp: "reset" });
    } else if (idx < stack.length - 1) {
      set({ stack: stack.slice(0, idx + 1), lastOp: "pop" });
    }
  },

  reset: (name) => set({ stack: [entry(name)], lastOp: "reset" }),
}));

// --- Android back interception ------------------------------------------------
// Not reactive state: registered/cleared in screen effects, read by ScreenStack's
// BackHandler. Returning true from the interceptor consumes the back press.

type BackInterceptor = () => boolean;

let backInterceptor: BackInterceptor | null = null;

export function setBackInterceptor(fn: BackInterceptor | null): void {
  backInterceptor = fn;
}

export function getBackInterceptor(): BackInterceptor | null {
  return backInterceptor;
}
