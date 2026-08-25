/**
 * Motion tiers — how much animation this device can afford to spend.
 *
 * Pure and dependency-light (no react-native, no expo-device import) so the
 * Node test suite can exercise the thresholds directly. The RN hook that feeds
 * these live signals lives in useMotion.ts, exactly as layout.ts / useLayout.ts
 * split the responsive tier.
 *
 * The board is the thing being protected. A movable pawn bobs on a repeating
 * timing loop, and because a Skia canvas rasterizes in full whenever any shared
 * value inside it moves, that loop keeps the whole pawn layer repainting at
 * display rate for as long as the player is deciding — which is most of every
 * turn. On a phone that cannot afford it, the reduced tier holds the same lift
 * still: the pawn still reads as movable, and the canvas goes quiet.
 */

/** What the app actually does. Derived, never stored. */
export type MotionTier = "full" | "reduced";

/** What the player asked for. Stored in settings; "auto" means "you decide". */
export type MotionPref = "auto" | "full" | "reduced";

export interface MotionSignals {
  /** Total RAM. Android reports this; iOS does not, and null is not "low". */
  totalMemoryBytes: number | null;
  /** Android's device year class. Null everywhere else. */
  deviceYear: number | null;
  /** The OS-wide "reduce motion" accessibility setting. */
  osReduceMotion: boolean;
  override: MotionPref;
}

/**
 * Below 3GB of RAM, a Skia canvas repainting at display rate competes with the
 * GC for the same budget. 3GB is the line most 2019-and-later budget Androids
 * sit above and most pre-2018 ones sit below.
 */
export const LOW_MEMORY_BYTES = 3 * 1024 ** 3;

/** Android device year class at or above which the full budget is affordable. */
export const LOW_DEVICE_YEAR = 2019;

/**
 * Pick the tier.
 *
 * Two rules carry the weight here:
 *
 * An explicit override always wins — including over the OS accessibility
 * setting. That switch is a system-wide default; a player who opened this app's
 * settings and asked for animation has made a specific, informed choice about
 * this app, and it is theirs to make. It cuts the other way too: a flagship
 * owner who finds the motion distracting can turn it down.
 *
 * An unknown signal reads as capable. `expo-device` returns null for both of
 * these on iOS, so treating null as "low" would silently downgrade every iPhone
 * in the fleet. A device we cannot measure gets the good experience; the
 * override is there for anyone we guess wrong about.
 */
export function motionTier(s: MotionSignals): MotionTier {
  if (s.override !== "auto") return s.override;
  if (s.osReduceMotion) return "reduced";
  if (s.totalMemoryBytes !== null && s.totalMemoryBytes < LOW_MEMORY_BYTES) return "reduced";
  if (s.deviceYear !== null && s.deviceYear < LOW_DEVICE_YEAR) return "reduced";
  return "full";
}
