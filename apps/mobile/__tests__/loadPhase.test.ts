/**
 * When a wait earns a skeleton, and when it stops deserving one.
 *
 * The rule that matters most is that held data beats a failed refresh: a shop
 * that already has a catalog must keep working when the network drops, and
 * must never trade a working grid for a retry card.
 */

import { describe, expect, it } from "vitest";
import {
  MIN_DWELL_MS,
  SHOW_AFTER_MS,
  STALL_AFTER_MS,
  loadPhase,
  skeletonView,
  type LoadSignals,
} from "../src/lib/loadPhase";

/** A wait that has just begun with nothing behind it. */
const FRESH: LoadSignals = { hasData: false, failed: false, elapsedMs: 0 };

describe("loadPhase", () => {
  it("is ready whenever we hold data, whatever else happened", () => {
    expect(loadPhase({ ...FRESH, hasData: true })).toBe("ready");
    expect(loadPhase({ hasData: true, failed: true, elapsedMs: 60_000 })).toBe("ready");
  });

  it("is cold while a young, unfailed wait has nothing to show", () => {
    expect(loadPhase(FRESH)).toBe("cold");
    expect(loadPhase({ ...FRESH, elapsedMs: STALL_AFTER_MS - 1 })).toBe("cold");
  });

  it("stalls on a failure, however early", () => {
    expect(loadPhase({ ...FRESH, failed: true })).toBe("stalled");
  });

  it("stalls once the wait passes the threshold", () => {
    expect(loadPhase({ ...FRESH, elapsedMs: STALL_AFTER_MS })).toBe("stalled");
    expect(loadPhase({ ...FRESH, elapsedMs: STALL_AFTER_MS + 1 })).toBe("stalled");
  });
});

describe("skeletonView", () => {
  it("shows nothing at all for a wait that resolves inside the show delay", () => {
    expect(skeletonView({ phase: "cold", waitMs: SHOW_AFTER_MS - 1, shownMs: null })).toBe("hidden");
    expect(skeletonView({ phase: "ready", waitMs: SHOW_AFTER_MS - 1, shownMs: null })).toBe("content");
  });

  it("paints the skeleton once the wait outlives the show delay", () => {
    expect(skeletonView({ phase: "cold", waitMs: SHOW_AFTER_MS, shownMs: null })).toBe("skeleton");
  });

  it("holds a painted skeleton for the minimum dwell, so it cannot blink", () => {
    expect(skeletonView({ phase: "ready", waitMs: 300, shownMs: MIN_DWELL_MS - 1 })).toBe("skeleton");
    expect(skeletonView({ phase: "ready", waitMs: 600, shownMs: MIN_DWELL_MS })).toBe("content");
  });

  it("never re-hides a skeleton it has already painted", () => {
    // waitMs is irrelevant once shownMs exists — the block is on screen.
    expect(skeletonView({ phase: "cold", waitMs: 10, shownMs: 5 })).toBe("skeleton");
  });

  it("gives a stalled wait the retry card", () => {
    expect(skeletonView({ phase: "stalled", waitMs: STALL_AFTER_MS, shownMs: 5000 })).toBe("stalled");
  });

  it("orders its constants so the delays cannot cross", () => {
    expect(SHOW_AFTER_MS).toBeLessThan(MIN_DWELL_MS);
    expect(MIN_DWELL_MS).toBeLessThan(STALL_AFTER_MS);
  });
});
