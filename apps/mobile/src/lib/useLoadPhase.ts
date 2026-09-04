/**
 * The live loading view: turns "do we have data" and "did it fail" into the one
 * value a screen renders on, with the dwell timers that stop a skeleton
 * flashing. Thin wrapper over the pure helpers in loadPhase.ts, exactly as
 * useMotion.ts wraps motionTier.ts.
 */

import { useEffect, useRef, useState } from "react";
import { loadPhase, skeletonView, type SkeletonView } from "./loadPhase";

/**
 * How often the view is re-evaluated while a wait is unsettled.
 *
 * A polled tick rather than timers armed at each boundary: the boundaries move
 * as `hasData` and `failed` change under it, and 10Hz for the length of a
 * network wait costs a comparison and, at most, one re-render of a screen whose
 * content is a handful of static blocks. It stops the moment the wait settles.
 */
const TICK_MS = 100;

export function useLoadPhase(hasData: boolean, failed: boolean): SkeletonView {
  const startedAt = useRef(Date.now());
  /** When the skeleton first painted; null until it has. */
  const shownAt = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const waitMs = now - startedAt.current;
  const view = skeletonView({
    phase: loadPhase({ hasData, failed, elapsedMs: waitMs }),
    waitMs,
    shownMs: shownAt.current === null ? null : now - shownAt.current,
  });

  // Stamped after the render that shows it, so the dwell is measured from the
  // frame the player could first see rather than from the decision to paint.
  useEffect(() => {
    if (view === "skeleton" && shownAt.current === null) shownAt.current = Date.now();
  }, [view]);

  const settled = view === "content" || view === "stalled";
  useEffect(() => {
    if (settled) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [settled]);

  return view;
}
