/**
 * The measured display refresh rate, as one value components can read.
 *
 * Thin requestAnimationFrame wrapper over the pure helper in refreshRate.ts
 * (kept separate so that stays Node-testable), exactly as useMotion.ts wraps
 * motionTier.ts.
 *
 * The probe runs once per app launch, not once per caller: the panel cannot
 * change while the app is running, so the result lives in a module variable and
 * every caller shares it. useSyncExternalStore is what lets the first callers
 * render with `null` — "not measured yet", which motionTier reads as ordinary —
 * and then re-render once the real number lands.
 */

import { useSyncExternalStore } from "react";
import { refreshHzFromDeltas } from "./refreshRate";

/**
 * Frames to collect. At 120Hz this is a third of a second; at 60Hz, two thirds.
 * Enough for the median to be stable, short enough that the answer is ready
 * well before the first board is drawn.
 */
const SAMPLE_COUNT = 40;

/**
 * Wait this long after launch before sampling.
 *
 * Sampling immediately measures the bundle still evaluating and the fonts still
 * loading, not the display — every frame would be starved and every device
 * would read as 60. That failure is safe (it leaves motionTier exactly as it
 * was) but it is also useless, and the whole point is to learn something. By a
 * second and a half the boot work has drained and frames arrive at the rate the
 * panel actually runs at.
 */
const START_DELAY_MS = 1500;

let measured: number | null = null;
let started = false;
const listeners = new Set<() => void>();

function probe(): void {
  const deltas: number[] = [];
  let prev = 0;

  const step = (now: number): void => {
    if (prev !== 0) deltas.push(now - prev);
    prev = now;
    if (deltas.length < SAMPLE_COUNT) {
      requestAnimationFrame(step);
      return;
    }
    measured = refreshHzFromDeltas(deltas);
    for (const notify of listeners) notify();
  };

  requestAnimationFrame(step);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!started) {
    started = true;
    // If the app is backgrounded before this fires, rAF simply stops and the
    // probe never completes. `measured` stays null, motionTier reads that as an
    // ordinary display, and the app behaves exactly as it did before this
    // signal existed. There is nothing to clean up and nothing to retry.
    setTimeout(probe, START_DELAY_MS);
  }
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): number | null {
  return measured;
}

/**
 * Frames per second this display delivers, or null until the probe lands.
 *
 * Null is not "slow" — it is "not known yet", and every consumer must treat it
 * as ordinary rather than as a reason to degrade.
 */
export function useRefreshHz(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
