/**
 * When a wait has earned a skeleton, and when it has stopped deserving one.
 *
 * Pure and dependency-light (no react-native import) so the Node test suite can
 * exercise the thresholds directly, exactly as motionTier.ts / useMotion.ts and
 * layout.ts / useLayout.ts split. The timers live in useLoadPhase.ts.
 *
 * The app is local-first: most stores persist, so most screens hold real data
 * before any request is made. A skeleton drawn over data we already have
 * replaces something true with something that only promises to become true.
 * Hence the rule this module encodes above all others — holding data wins over
 * every other signal, a failed refresh included.
 */

/** What the fetch is doing. */
export type LoadPhase = "cold" | "stalled" | "ready";

/** What the screen should actually render. */
export type SkeletonView = "hidden" | "skeleton" | "stalled" | "content";

export interface LoadSignals {
  /** Do we hold something worth showing right now? */
  hasData: boolean;
  /** Has an attempt finished and failed? */
  failed: boolean;
  /** ms since this wait began. */
  elapsedMs: number;
}

/**
 * How long a wait may go unexplained before it is treated as broken.
 *
 * A skeleton that shimmers forever is worse than an empty grid — it promises
 * content that is not coming and offers nothing to do about it. Six seconds
 * sits just past ConnectionStrip's AT_RISK_AFTER_MS of 5000, which is already
 * this app's answer to "how long before a wait is worth mentioning".
 */
export const STALL_AFTER_MS = 6000;

/** Below this, a wait resolves faster than a skeleton could be read. */
export const SHOW_AFTER_MS = 120;

/** Once painted, a skeleton stays this long — a blink reads as a glitch. */
export const MIN_DWELL_MS = 400;

export function loadPhase(s: LoadSignals): LoadPhase {
  if (s.hasData) return "ready";
  if (s.failed || s.elapsedMs >= STALL_AFTER_MS) return "stalled";
  return "cold";
}

/**
 * The anti-flash pair, applied.
 *
 * `shownMs` is null until the skeleton has actually painted. That is what
 * separates "too early to bother" from "already on screen, do not yank it".
 */
export function skeletonView(o: {
  phase: LoadPhase;
  waitMs: number;
  shownMs: number | null;
}): SkeletonView {
  const { phase, waitMs, shownMs } = o;
  if (phase === "ready") {
    return shownMs !== null && shownMs < MIN_DWELL_MS ? "skeleton" : "content";
  }
  if (phase === "stalled") return "stalled";
  return waitMs < SHOW_AFTER_MS && shownMs === null ? "hidden" : "skeleton";
}
