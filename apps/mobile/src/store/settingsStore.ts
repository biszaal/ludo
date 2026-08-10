/**
 * Device preferences — persisted across launches. Pure user-facing toggles; no
 * game state lives here. Consumers read reactively (components) or via
 * useSettings.getState() (sound/haptics modules).
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { kvStorage } from "../lib/storage";
import type { BoardThemeId } from "../render/boardThemes";

interface SettingsState {
  soundOn: boolean;
  musicOn: boolean;
  hapticsOn: boolean;
  /** Wants push notifications. Defaults ON so the OS prompt is the only real
   *  gate — an app-level toggle defaulting off would mean two refusals to get
   *  past, and the OS one is the honest place to ask. */
  pushOn: boolean;
  boardThemeId: BoardThemeId;
  setSound: (v: boolean) => void;
  setMusic: (v: boolean) => void;
  setHaptics: (v: boolean) => void;
  setPush: (v: boolean) => void;
  setBoardTheme: (id: BoardThemeId) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      soundOn: true,
      musicOn: true,
      hapticsOn: true,
      pushOn: true,
      boardThemeId: "classic",
      setSound: (v) => set({ soundOn: v }),
      setMusic: (v) => set({ musicOn: v }),
      setHaptics: (v) => set({ hapticsOn: v }),
      setPush: (v) => set({ pushOn: v }),
      setBoardTheme: (id) => set({ boardThemeId: id }),
    }),
    {
      name: "ludo-settings",
      version: 1,
      storage: createJSONStorage(kvStorage),
    },
  ),
);
