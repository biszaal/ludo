/**
 * Audio sync: sounds are ASKED FOR early so they are HEARD on the beat.
 *
 * expo-audio gives no way to play a sound now — `play()` has to cross to the
 * Android main thread and the audio track then has to start — so every sound
 * that belongs to a visual moment is issued SFX_LEAD_MS ahead of it. These
 * tests pin the arithmetic that does the shifting, because the failure it
 * guards against is not a crash: it is a thock a cell out of step, which reads
 * as "the sound is wrong" and takes a device to notice.
 *
 * The property that matters is that the lead is applied ONCE, to the run-up.
 * Applying it per cell would compound into a whole hop of drift by the sixth.
 */

import { describe, expect, it } from "vitest";
import { FLY_MS, HOP_STEP_MS, SFX_LEAD_MS, cueDurations } from "../src/lib/moveTiming";

/** When each cue actually fires, relative to the start of the animation. */
const fireTimes = (durations: number[]): number[] => {
  let t = 0;
  return durations.map((d) => (t += d));
};

/** When each pawn landing happens, for the same move. */
const landings = (cells: number, firstMs: number, everyMs: number): number[] =>
  Array.from({ length: cells }, (_, i) => firstMs + i * everyMs);

describe("cueDurations", () => {
  it("fires one cue per sounding cell", () => {
    expect(cueDurations(6, HOP_STEP_MS, HOP_STEP_MS)).toHaveLength(6);
  });

  it("leads every landing of a six-cell hop by exactly the lead", () => {
    const cells = 6;
    const fires = fireTimes(cueDurations(cells, HOP_STEP_MS, HOP_STEP_MS));
    const lands = landings(cells, HOP_STEP_MS, HOP_STEP_MS);
    expect(lands.map((t, i) => t - fires[i]!)).toEqual(Array(cells).fill(SFX_LEAD_MS));
  });

  it("keeps the cadence of the hops, not just the first beat", () => {
    // The compounding bug: subtracting the lead from every segment would give
    // gaps of HOP_STEP_MS - SFX_LEAD_MS and the sixth thock would land a whole
    // cell early.
    const fires = fireTimes(cueDurations(6, HOP_STEP_MS, HOP_STEP_MS));
    const gaps = fires.slice(1).map((t, i) => t - fires[i]!);
    expect(gaps).toEqual(Array(5).fill(HOP_STEP_MS));
  });

  it("leads a yard-exit fly, which sounds once on arrival", () => {
    expect(fireTimes(cueDurations(1, FLY_MS, FLY_MS))).toEqual([FLY_MS - SFX_LEAD_MS]);
  });

  it("leads a retrace's single arrival, not its fifty cells", () => {
    // A captured pawn glides home and thocks once, when it gets there.
    const total = 50 * HOP_STEP_MS;
    expect(cueDurations(1, total, HOP_STEP_MS)).toEqual([total - SFX_LEAD_MS]);
  });

  it("fires at once rather than negatively when the run-up is shorter than the lead", () => {
    // A one-cell hop on a motion tier fast enough that the landing arrives
    // inside the pipeline's own delay. As early as possible is the best
    // available answer; it must not be a negative duration.
    expect(cueDurations(2, 40, 40)).toEqual([0, 40]);
  });

  it("is empty for a move with nothing to sound", () => {
    expect(cueDurations(0, HOP_STEP_MS, HOP_STEP_MS)).toEqual([]);
  });
});
