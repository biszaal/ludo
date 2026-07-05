/**
 * Top-level route for the online overlay. Local pass-and-play continues to route
 * through useGameStore.screen; when an online flow is active this takes over.
 */

import { create } from "zustand";

export type Route = "none" | "lobby" | "onlineGame";

interface NavStore {
  route: Route;
  go: (route: Route) => void;
}

export const useNav = create<NavStore>((set) => ({
  route: "none",
  go: (route) => set({ route }),
}));
