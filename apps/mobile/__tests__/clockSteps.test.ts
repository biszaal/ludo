/**
 * How often the turn clock is allowed to repaint.
 *
 * The clock is the only thing on screen for most of an online match, and it
 * used to repaint on every display frame for the whole of every turn — measured
 * on a Galaxy S26 Ultra as one Skia redraw per frame, the whole match long, so
 * the phone never got to idle. It only has to repaint when what it shows has
 * actually moved, which for a ring a few hundred pixels round draining over
 * thirty seconds is a small fraction of the frames.
 */

import { describe, expect, it } from "vitest";
import { MAX_STEPS_PER_SECOND, clockSteps, steppedProgress } from "../src/lib/clockSteps";

describe("clockSteps", () => {
  it("gives a long turn one step per physical pixel of the clock", () => {
    // A 584px ring over a 30s turn: 584 steps, ~19 repaints a second.
    expect(clockSteps(584, 30)).toBe(584);
  });

  it("caps a short turn at MAX_STEPS_PER_SECOND instead of repainting every frame", () => {
    // Two seconds left on a 584px ring would otherwise want ~290 repaints a
    // second, more than any display delivers — i.e. every frame again.
    expect(clockSteps(584, 2)).toBe(2 * MAX_STEPS_PER_SECOND);
  });

  it("never repaints faster than the cap, whatever the clock's size", () => {
    for (const px of [40, 174, 584, 2000]) {
      for (const seconds of [1, 5, 12, 30]) {
        expect(clockSteps(px, seconds) / seconds).toBeLessThanOrEqual(MAX_STEPS_PER_SECOND);
      }
    }
  });

  it("always has at least one step", () => {
    expect(clockSteps(0, 30)).toBe(1);
    expect(clockSteps(584, 0)).toBe(1);
  });

  it("rounds fractional pixels up rather than losing the last one", () => {
    expect(clockSteps(583.2, 30)).toBe(584);
  });
});

describe("steppedProgress", () => {
  it("shows a full clock at the start and an empty one at the end", () => {
    expect(steppedProgress(1, 100)).toBe(1);
    expect(steppedProgress(0, 100)).toBe(0);
  });

  it("holds each step until it has fully elapsed", () => {
    // Snapping UP means the clock never reads emptier than the time left —
    // it cannot tell a player they are out while they still have a sliver.
    expect(steppedProgress(0.991, 100)).toBe(1);
    expect(steppedProgress(0.99, 100)).toBe(0.99);
    expect(steppedProgress(0.001, 100)).toBe(0.01);
  });

  it("only moves when a step boundary is crossed", () => {
    const seen = new Set<number>();
    for (let i = 0; i <= 1000; i++) seen.add(steppedProgress(1 - i / 1000, 10));
    // 11 positions: 1, 0.9, … 0.1, 0 — not a thousand.
    expect(seen.size).toBe(11);
  });

  it("clamps an overshooting animation into the drawable range", () => {
    expect(steppedProgress(1.2, 10)).toBe(1);
    expect(steppedProgress(-0.3, 10)).toBe(0);
  });
});
