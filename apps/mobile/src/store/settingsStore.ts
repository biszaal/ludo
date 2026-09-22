/**
 * Device preferences — persisted across launches. Pure user-facing toggles; no
 * game state lives here. Consumers read reactively (components) or via
 * useSettings.getState() (sound/haptics modules).
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { kvStorage } from "../lib/storage";
import { clampVolume } from "../lib/sliderMath";
import type { MotionPref } from "../lib/motionTier";
import type { BoardThemeId } from "../render/boardThemes";

interface SettingsState {
  soundOn: boolean;
  musicOn: boolean;
  hapticsOn: boolean;
  /**
   * Master levels, 0..1, one per channel.
   *
   * These MULTIPLY the per-sound levels in lib/sound rather than replacing
   * them — the mix there (a hop quieter than a capture, music quieter than
   * everything) is a balance, and this is a hand on the whole channel. Hence
   * the default of 1: a player who never touches a slider must hear exactly
   * what they heard before the sliders existed.
   *
   * Kept separate from soundOn/musicOn so a mute is not a lost level. Muting
   * is the fast, reversible thing people do mid-game; coming back to a slider
   * they had set to 30% and finding it at 0 would be a small theft.
   */
  soundVolume: number;
  musicVolume: number;
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
  setSoundVolume: (v: number) => void;
  setMusicVolume: (v: number) => void;
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
 * Written as a chain rather than a switch because a player who skipped a
 * release arrives at the OLD version and has to be walked through every step
 * in between — a v1 blob needs the motionPref step AND the volume step, and a
 * migration that only applies the latest one leaves them missing a field.
 *
 * v1 -> v2 adds `motionPref`, defaulting to "auto" rather than to a tier: an
 * upgrading player has never been asked, so the device should still answer.
 * v2 -> v3 adds the two volume masters at full, for the same reason — nobody
 * has set a level yet, and anything below 1 would quietly turn their game down.
 */
export function migrateSettings(persisted: unknown, version: number): unknown {
  let prev = (persisted ?? {}) as Record<string, unknown>;
  if (version < 2) prev = { ...prev, motionPref: "auto" satisfies MotionPref };
  // Spread `prev` last so a level already stored wins — including 0, which a
  // `??` on the wrong side of the spread would read as absent.
  if (version < 3) prev = { soundVolume: 1, musicVolume: 1, ...prev };
  return prev;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      soundOn: true,
      musicOn: true,
      hapticsOn: true,
      soundVolume: 1,
      musicVolume: 1,
      pushOn: true,
      bonusRemindersOn: true,
      boardThemeId: "classic",
      motionPref: "auto",
      setSound: (v) => set({ soundOn: v }),
      setMusic: (v) => set({ musicOn: v }),
      // Clamped here, not at the call site. The caller is a gesture, and a
      // value off the end of the track — or a NaN from a track measured at
      // zero width one frame before layout — would persist and then be silent
      // on every later launch with nothing on screen to explain it.
      setSoundVolume: (v) => set({ soundVolume: clampVolume(v) }),
      setMusicVolume: (v) => set({ musicVolume: clampVolume(v) }),
      setHaptics: (v) => set({ hapticsOn: v }),
      setPush: (v) => set({ pushOn: v }),
      setBonusReminders: (v) => set({ bonusRemindersOn: v }),
      setBoardTheme: (id) => set({ boardThemeId: id }),
      setMotionPref: (v) => set({ motionPref: v }),
    }),
    {
      name: "ludo-settings",
      version: 3,
      migrate: migrateSettings,
      storage: createJSONStorage(kvStorage),
    },
  ),
);
