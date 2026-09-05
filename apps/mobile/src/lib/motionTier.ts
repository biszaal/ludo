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
  /**
   * Android's device-year-class score. Null everywhere else, and -1 on an
   * Android device the library could not measure. See LOW_DEVICE_YEAR: this is
   * a capped capability score, not the year the phone was made.
   */
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

/**
 * Device-year-class score at or above which the full budget is affordable.
 *
 * This number looks like a year and is not one. `expo-device` gets it from
 * Facebook's device-year-class, a library last touched in 2015, which scores a
 * phone as the median of three probes that are themselves capped: CPU cores top
 * out at 2012, clock speed at 2014, RAM at 2014. **2014 is therefore the highest
 * score any Android device can report** — a phone bought today reports the same
 * 2014 as one from a decade ago, and the CLASS_2015/CLASS_2016 constants the
 * library still exports are unreachable through this code path.
 *
 * The threshold used to be 2019. Nothing can score 2019, so the comparison was
 * always true and every Android device in the fleet — flagships included — was
 * held on the reduced tier, while iPhones (null, unmeasurable) kept the full
 * one. It showed up as a matchmaking screen with no ripple and no breathing
 * seats: a screen that looked broken rather than calm.
 *
 * So the line has to sit inside 2008..2014. At 2014 the score only drags a
 * device down when the clock or RAM probe says so, which pairs with the memory
 * rule above instead of duplicating it.
 */
export const LOW_DEVICE_YEAR = 2014;

/** device-year-class reports "could not measure" as -1, where iOS reports null. */
const YEAR_CLASS_UNKNOWN = -1;

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
 * override is there for anyone we guess wrong about. Android spells that same
 * unknown -1 rather than null, and -1 is a sentinel, not an ancient phone.
 */
export function motionTier(s: MotionSignals): MotionTier {
  if (s.override !== "auto") return s.override;
  if (s.osReduceMotion) return "reduced";
  if (s.totalMemoryBytes !== null && s.totalMemoryBytes < LOW_MEMORY_BYTES) return "reduced";
  if (s.deviceYear !== null && s.deviceYear !== YEAR_CLASS_UNKNOWN && s.deviceYear < LOW_DEVICE_YEAR) {
    return "reduced";
  }
  return "full";
}
