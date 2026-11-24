/**
 * Has the loading screen faded yet?
 *
 * Home is drawn underneath the loading screen from the start, so anything on
 * Home that runs on a clock (the welcome intro's auto-advance) would spend its
 * first seconds behind it. App.tsx flips this when the loading screen is gone.
 * Not persisted: every launch starts behind the loading screen.
 */

import { create } from "zustand";

interface LaunchState {
  launched: boolean;
  markLaunched: () => void;
}

export const useLaunch = create<LaunchState>()((set) => ({
  launched: false,
  markLaunched: () => set({ launched: true }),
}));
