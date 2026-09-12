/**
 * Turning a run of frame deltas into a display refresh rate.
 *
 * Neither Expo SDK 56 nor React Native exposes the panel's refresh rate to JS —
 * `expo-device` reports memory, year class and CPU, and nothing about the
 * display — so the only way to learn it without a native module is to watch how
 * fast frames actually arrive. Measuring beats declaring anyway: what matters to
 * motionTier is the rate the device DELIVERS, not the rate the spec sheet
 * claims, and an LTPO panel's claimed maximum is not where it spends its time.
 *
 * Pure and free of react-native so the Node suite can exercise it directly; the
 * requestAnimationFrame loop that feeds it lives in useRefreshRate.ts, the same
 * split as motionTier.ts / useMotion.ts.
 *
 * The asymmetry below is deliberate and is the whole design. Reading a 120Hz
 * panel as 60 costs nothing — motionTier simply behaves as it did before this
 * signal existed. Reading a 60Hz panel as 120 takes the idle animations away
 * from a phone that could afford them. So every judgement call here leans
 * toward reading LOW.
 */

/**
 * Deltas shorter than this are not frames.
 *
 * 3ms is 333Hz, which no phone panel does. A delta that short means two
 * callbacks were coalesced into a single frame, and it is exactly why this
 * module takes a median rather than the fastest sample: one coalesced pair
 * would otherwise read as "1000Hz" and downgrade the device on the strength of
 * a measurement artefact.
 */
export const MIN_PLAUSIBLE_DELTA_MS = 3;

/**
 * Deltas longer than this are jank, not cadence.
 *
 * 100ms is 10fps. A panel does not run there; a JS thread blocked by a bundle
 * parse or a Skia upload does. Dropping these keeps a stutter during the probe
 * from being mistaken for the display's natural rate.
 */
export const MAX_PLAUSIBLE_DELTA_MS = 100;

/** Below this many usable samples, say "I don't know" rather than guess. */
export const MIN_SAMPLES = 8;

/**
 * Frames per second implied by these deltas, or null if they don't support an
 * answer.
 *
 * The median is doing specific work. A mean would let three dropped frames drag
 * a 120Hz panel down into the 60s; the fastest sample would let one coalesced
 * callback push a 60Hz panel up past 120. The median ignores both tails, and
 * when the samples are genuinely split — half fast, half starved by startup
 * work — it lands in the middle and reports ordinary, which is the safe answer.
 */
export function refreshHzFromDeltas(deltas: number[]): number | null {
  const usable = deltas
    .filter((d) => Number.isFinite(d) && d >= MIN_PLAUSIBLE_DELTA_MS && d <= MAX_PLAUSIBLE_DELTA_MS)
    .sort((a, b) => a - b);
  if (usable.length < MIN_SAMPLES) return null;

  const mid = usable.length / 2;
  const median =
    usable.length % 2 === 0 ? (usable[mid - 1] + usable[mid]) / 2 : usable[Math.floor(mid)];
  return 1000 / median;
}
