/**
 * Reading a display's refresh rate from frame deltas.
 *
 * The asymmetry here is the whole design. Reading a 120Hz panel as 60 is
 * harmless — motionTier just behaves exactly as it did before this signal
 * existed. Reading a 60Hz panel as 120 takes the idle animations away from a
 * phone that could afford them. So every judgement call in this module leans
 * toward reading LOW, and the tests below pin that lean in place.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_PLAUSIBLE_DELTA_MS,
  MIN_PLAUSIBLE_DELTA_MS,
  MIN_SAMPLES,
  refreshHzFromDeltas,
} from "../src/lib/refreshRate";

/** `n` frame deltas for a panel running cleanly at `hz`. */
const steady = (hz: number, n = 30): number[] => Array.from({ length: n }, () => 1000 / hz);

describe("refreshHzFromDeltas", () => {
  it("reads the common panel rates", () => {
    expect(refreshHzFromDeltas(steady(60))).toBeCloseTo(60, 0);
    expect(refreshHzFromDeltas(steady(90))).toBeCloseTo(90, 0);
    expect(refreshHzFromDeltas(steady(120))).toBeCloseTo(120, 0);
  });

  it("returns null rather than guessing from too few samples", () => {
    expect(refreshHzFromDeltas([])).toBeNull();
    expect(refreshHzFromDeltas(steady(120, MIN_SAMPLES - 1))).toBeNull();
    expect(refreshHzFromDeltas(steady(120, MIN_SAMPLES))).not.toBeNull();
  });

  it("ignores a few janked frames instead of reading the panel as slow", () => {
    // A 120Hz panel that dropped three frames is still a 120Hz panel. The
    // median shrugs these off; a mean would not.
    const deltas = [...steady(120, 27), 140, 95, 210];
    expect(refreshHzFromDeltas(deltas)).toBeCloseTo(120, 0);
  });

  it("ignores impossibly short deltas instead of reading the panel as fast", () => {
    // Two callbacks coalesced into one frame produce a ~0ms delta. Taking the
    // fastest sample would turn that into "1000Hz" and downgrade the device.
    const deltas = [...steady(60, 27), 0, 0.4, 1];
    expect(refreshHzFromDeltas(deltas)).toBeCloseTo(60, 0);
  });

  it("discards deltas outside the plausible range, from both ends", () => {
    const tooFast = Array.from({ length: 30 }, () => MIN_PLAUSIBLE_DELTA_MS / 2);
    const tooSlow = Array.from({ length: 30 }, () => MAX_PLAUSIBLE_DELTA_MS * 2);
    expect(refreshHzFromDeltas(tooFast)).toBeNull();
    expect(refreshHzFromDeltas(tooSlow)).toBeNull();
  });

  it("reads a device that is genuinely struggling as slow, not as null", () => {
    // 30fps is implausible for a PANEL but entirely plausible as a delivered
    // rate, and it is a true signal about the device. Keep it.
    expect(refreshHzFromDeltas(steady(30))).toBeCloseTo(30, 0);
  });

  it("reads a busy boot on a 120Hz panel as ordinary rather than high", () => {
    // The safe failure: if half the samples are starved by startup work, the
    // median lands near 60 and motionTier behaves exactly as it does today.
    const deltas = [...steady(120, 15), ...steady(30, 15)];
    const hz = refreshHzFromDeltas(deltas)!;
    expect(hz).toBeLessThan(90);
  });

  it("survives garbage input without throwing", () => {
    expect(refreshHzFromDeltas([NaN, Infinity, -5, 0])).toBeNull();
  });
});
