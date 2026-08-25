/**
 * Device preferences — persisted across launches. Pure user-facing toggles; no
 * game state lives here. Consumers read reactively (components) or via
 * useSettings.getState() (sound/haptics modules).
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { kvStorage } from "../lib/storage";
import type { MotionPref } from "../lib/motionTier";
import type { BoardThemeId } from "../render/boardThemes";

interface SettingsState {
  soundOn: boolean;
  musicOn: boolean;
  hapticsOn: boolean;
  /** Wants push notifications. Defaults ON so the OS prompt is the only real
   *  gate — an app-level toggle defaulting off would mean two refusals to get
   *  past, and the OS one is the honest place to ask. */
  pushOn: boolean;
  /** Wants the "daily bonus ready" reminder. Separate from pushOn because they
   *  are different bargains: one is a person asking you to play, the other is
   *  the game asking for your attention. A player who silences the second has
   *  not asked to stop hearing from their friends. */
  bonusRemindersOn: boolean;
  boardThemeId: BoardThemeId;
  /** How much animation to spend. "auto" lets the device tier decide; the
   *  other two pin it, so a phone we guess wrong about is never stuck. */
  motionPref: MotionPref;
  setSound: (v: boolean) => void;
  setMusic: (v: boolean) => void;
  setHaptics: (v: boolean) => void;
  setPush: (v: boolean) => void;
  setBonusReminders: (v: boolean) => void;
  setBoardTheme: (id: BoardThemeId) => void;
  setMotionPref: (v: MotionPref) => void;
}

/**
 * Carry a persisted settings blob forward.
 *
 * Exported for the test suite: a migration is only ever exercised on a real
 * device once, by an upgrading player, and if it drops a field they set that
 * loss is silent. Testing it directly is the only way to see it fail.
 *
 * v1 -> v2 adds `motionPref`. Everything else is left exactly as stored, and a
 * missing preference defaults to "auto" rather than to a tier — an upgrading
 * player has never been asked, so the device should still be the one to answer.
 */
export function migrateSettings(persisted: unknown, version: number): unknown {
  const prev = (persisted ?? {}) as Record<string, unknown>;
  if (version >= 2) return prev;
  return { ...prev, motionPref: "auto" satisfies MotionPref };
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      soundOn: true,
      musicOn: true,
      hapticsOn: true,
      pushOn: true,
      bonusRemindersOn: true,
      boardThemeId: "classic",
      motionPref: "auto",
      setSound: (v) => set({ soundOn: v }),
      setMusic: (v) => set({ musicOn: v }),
      setHaptics: (v) => set({ hapticsOn: v }),
      setPush: (v) => set({ pushOn: v }),
      setBonusReminders: (v) => set({ bonusRemindersOn: v }),
      setBoardTheme: (id) => set({ boardThemeId: id }),
      setMotionPref: (v) => set({ motionPref: v }),
    }),
    {
      name: "ludo-settings",
      version: 2,
      migrate: migrateSettings,
      storage: createJSONStorage(kvStorage),
    },
  ),
);
