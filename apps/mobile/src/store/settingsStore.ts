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
  boardThemeId: BoardThemeId;
  setSound: (v: boolean) => void;
  setMusic: (v: boolean) => void;
  setHaptics: (v: boolean) => void;
  setBoardTheme: (id: BoardThemeId) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      soundOn: true,
      musicOn: true,
      hapticsOn: true,
      boardThemeId: "classic",
      setSound: (v) => set({ soundOn: v }),
      setMusic: (v) => set({ musicOn: v }),
      setHaptics: (v) => set({ hapticsOn: v }),
      setBoardTheme: (id) => set({ boardThemeId: id }),
    }),
    {
      name: "ludo-settings",
      version: 1,
      storage: createJSONStorage(kvStorage),
    },
  ),
);
