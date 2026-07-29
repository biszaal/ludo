/**
 * Cosmetic dice-pip glyphs and face-overlay decorations for skinned dice.
 * Pure geometry — appendPip/overlayArt run inside Dice.tsx's per-frame Skia
 * worklet, so they're tested here through a recording fake instead of a real
 * SkPath (this env has no Skia). The load-bearing guarantee: every emitted
 * coordinate stays within the glyph's bounding box, because Bezier curves are
 * contained in the convex hull of their control points — bounding the raw
 * coordinates passed to the sink bounds the drawn shape too.
 */

import { describe, expect, it } from "vitest";
import { appendPip, mulberry32, overlayArt, type PathSink, type PipShape } from "../src/render/pipShapes";

class RecordingSink implements PathSink {
  points: [number, number][] = [];
  moveCount = 0;
  closed = false;
  moveTo(x: number, y: number) {
    this.moveCount++;
    this.points.push([x, y]);
  }
  lineTo(x: number, y: number) {
    this.points.push([x, y]);
  }
  quadTo(cx: number, cy: number, x: number, y: number) {
    this.points.push([cx, cy], [x, y]);
  }
  cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
    this.points.push([c1x, c1y], [c2x, c2y], [x, y]);
  }
  close() {
    this.closed = true;
  }
}

const SHAPES: Exclude<PipShape, "dot">[] = ["heart", "star", "diamond", "crown", "flame"];

describe("appendPip", () => {
  for (const shape of SHAPES) {
    it(`draws a closed ${shape} bounded to its radius`, () => {
      const sink = new RecordingSink();
      appendPip(sink, shape, 10, 20, 4);
      expect(sink.moveCount).toBeGreaterThanOrEqual(1);
      expect(sink.closed).toBe(true);
      expect(sink.points.length).toBeGreaterThan(2);
      for (const [x, y] of sink.points) {
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(10 - 4 * 1.1);
        expect(x).toBeLessThanOrEqual(10 + 4 * 1.1);
        expect(y).toBeGreaterThanOrEqual(20 - 4 * 1.1);
        expect(y).toBeLessThanOrEqual(20 + 4 * 1.1);
      }
    });
  }

  it("scales and translates linearly (same shape at a different center/radius)", () => {
    const a = new RecordingSink();
    appendPip(a, "star", 0, 0, 1);
    const b = new RecordingSink();
    appendPip(b, "star", 5, 7, 2);
    expect(a.points.length).toBe(b.points.length);
    for (let i = 0; i < a.points.length; i++) {
      expect(b.points[i]![0]).toBeCloseTo(5 + a.points[i]![0]! * 2, 10);
      expect(b.points[i]![1]).toBeCloseTo(7 + a.points[i]![1]! * 2, 10);
    }
  });

  it("gives the shapes visually distinct silhouettes (not all the same point count)", () => {
    const counts = new Set(
      SHAPES.map((shape) => {
        const sink = new RecordingSink();
        appendPip(sink, shape, 0, 0, 1);
        return sink.points.length;
      }),
    );
    expect(counts.size).toBeGreaterThan(1);
  });
});

describe("overlayArt", () => {
  const KINDS = ["stars", "veins", "grain", "facets"] as const;

  it("is deterministic for a given seed", () => {
    for (const kind of KINDS) {
      expect(overlayArt(kind, 42)).toEqual(overlayArt(kind, 42));
    }
  });

  it("varies with the seed", () => {
    for (const kind of KINDS) {
      expect(overlayArt(kind, 1)).not.toEqual(overlayArt(kind, 2));
    }
  });

  it("bounds every coordinate to the unit square with no NaN, and draws something", () => {
    for (const kind of KINDS) {
      const art = overlayArt(kind, 7);
      for (const d of art.dots) {
        expect(d.x).toBeGreaterThanOrEqual(0);
        expect(d.x).toBeLessThanOrEqual(1);
        expect(d.y).toBeGreaterThanOrEqual(0);
        expect(d.y).toBeLessThanOrEqual(1);
        expect(d.r).toBeGreaterThan(0);
        expect(d.a).toBeGreaterThan(0);
        expect(d.a).toBeLessThanOrEqual(1);
      }
      for (const s of art.strokes) {
        expect(s.pts.length).toBeGreaterThanOrEqual(2);
        for (const [x, y] of s.pts) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(1);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(1);
        }
        expect(s.w).toBeGreaterThan(0);
        expect(s.a).toBeGreaterThan(0);
        expect(s.a).toBeLessThanOrEqual(1);
      }
      expect(art.dots.length + art.strokes.length).toBeGreaterThan(0);
    }
  });

  it("gives each overlay kind a distinct look", () => {
    const shapes = KINDS.map((k) => JSON.stringify(overlayArt(k, 7)));
    expect(new Set(shapes).size).toBe(KINDS.length);
  });
});

describe("mulberry32", () => {
  it("is deterministic and stays in [0, 1)", () => {
    const rng = mulberry32(123);
    for (let i = 0; i < 50; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("reproduces the same sequence for the same seed, and differs across seeds", () => {
    const seq = (seed: number) => {
      const rng = mulberry32(seed);
      return [rng(), rng(), rng()];
    };
    expect(seq(99)).toEqual(seq(99));
    expect(seq(99)).not.toEqual(seq(100));
  });
});
