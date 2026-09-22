/**
 * Volume slider math.
 *
 * Lives apart from the component for the same reason soundPool does: the
 * interesting part is arithmetic, and arithmetic is only ever checked by
 * running it. A slider that is one step off at the ends is invisible in a
 * screenshot and obvious on a sofa — the thumb sits a hair short of the rail
 * at 100%, or 0% still makes a noise.
 */

import { describe, expect, it } from "vitest";
import { STEP, clampVolume, stepVolume, valueFromTouch, volumePercent } from "../src/lib/sliderMath";

describe("clampVolume", () => {
  it("keeps a sane value as it is", () => {
    expect(clampVolume(0.45)).toBe(0.45);
  });

  it("pins values outside 0..1 to the rail", () => {
    expect(clampVolume(-0.2)).toBe(0);
    expect(clampVolume(4)).toBe(1);
  });

  it("treats a non-finite value as full volume rather than silence", () => {
    // A NaN reaching the store would persist and mute the app with no visible
    // cause; full is the safer of the two ends to fall back to.
    expect(clampVolume(Number.NaN)).toBe(1);
    expect(clampVolume(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("valueFromTouch", () => {
  const W = 200;

  it("maps the two ends of the track to silence and full", () => {
    expect(valueFromTouch(0, W)).toBe(0);
    expect(valueFromTouch(W, W)).toBe(1);
  });

  it("maps the middle to half", () => {
    expect(valueFromTouch(100, W)).toBe(0.5);
  });

  it("snaps between steps rather than landing on 37%", () => {
    // 0.37 of the way along is nearer 35% than 40%.
    expect(valueFromTouch(74, W)).toBeCloseTo(0.35, 5);
    expect(valueFromTouch(78, W)).toBeCloseTo(0.4, 5);
  });

  it("holds a drag that leaves the track at the rail it left by", () => {
    expect(valueFromTouch(-80, W)).toBe(0);
    expect(valueFromTouch(W + 80, W)).toBe(1);
  });

  it("reports silence for a zero-width track instead of dividing by it", () => {
    // One frame before layout the width is 0; NaN here would reach the store.
    expect(valueFromTouch(50, 0)).toBe(0);
  });

  it("lands every step exactly, so a full sweep has no drift", () => {
    for (let i = 0; i <= 1 / STEP; i += 1) {
      const x = (W * i) / (1 / STEP);
      expect(valueFromTouch(x, W)).toBeCloseTo(i * STEP, 10);
    }
  });
});

describe("stepVolume", () => {
  it("moves by one step for the accessibility actions", () => {
    expect(stepVolume(0.5, 1)).toBeCloseTo(0.55, 5);
    expect(stepVolume(0.5, -1)).toBeCloseTo(0.45, 5);
  });

  it("stops at the rails", () => {
    expect(stepVolume(1, 1)).toBe(1);
    expect(stepVolume(0, -1)).toBe(0);
  });

  it("snaps an off-grid stored value onto the grid as it moves", () => {
    // A value persisted before the grid existed, or by a future finer slider.
    expect(stepVolume(0.37, 1)).toBeCloseTo(0.4, 5);
    expect(stepVolume(0.37, -1)).toBeCloseTo(0.35, 5);
  });
});

describe("volumePercent", () => {
  it("reads as a whole number with no floating-point tail", () => {
    expect(volumePercent(0.35)).toBe(35);
    expect(volumePercent(0.1 + 0.2)).toBe(30);
    expect(volumePercent(1)).toBe(100);
    expect(volumePercent(0)).toBe(0);
  });
});
