/**
 * The numeral glyphs for the Numerals dice tier. These are hand-built
 * centerline paths drawn inside a Skia recording on the UI thread, where
 * nothing can be inspected — so the invariants a caller actually relies on
 * (every die value draws something, nothing escapes the face, the glyph
 * follows its center and scale) are pinned here, in Node, where they can be.
 */

import { describe, expect, it } from "vitest";
import { appendNumeral, NUMERAL_FACE_R, NUMERAL_KEYLINE, NUMERAL_STROKE, type Numeral } from "../src/render/dieNumerals";

const VALUES: Numeral[] = [1, 2, 3, 4, 5, 6];

/** Records every coordinate handed to the sink, control points included. */
function trace(digit: Numeral, cx = 0, cy = 0, r = 1) {
  const pts: [number, number][] = [];
  const ops: string[] = [];
  const push = (...xy: number[]) => {
    for (let i = 0; i < xy.length; i += 2) pts.push([xy[i]!, xy[i + 1]!]);
  };
  appendNumeral(
    {
      moveTo: (x, y) => { ops.push("M"); push(x, y); },
      lineTo: (x, y) => { ops.push("L"); push(x, y); },
      cubicTo: (a, b, c, d, e, f) => { ops.push("C"); push(a, b, c, d, e, f); },
    },
    digit,
    cx,
    cy,
    r,
  );
  return { pts, ops };
}

describe("appendNumeral", () => {
  it("draws every die value", () => {
    for (const v of VALUES) {
      const { pts, ops } = trace(v);
      expect(ops.length, `digit ${v}`).toBeGreaterThan(1);
      expect(pts.length, `digit ${v}`).toBeGreaterThan(3);
    }
  });

  it("starts every subpath with a move, never a dangling line or curve", () => {
    // A stroked path whose first op is a lineTo picks up wherever the previous
    // glyph left off, which on a shared SkPath draws a hairline across the die.
    for (const v of VALUES) {
      expect(trace(v).ops[0], `digit ${v}`).toBe("M");
    }
  });

  it("keeps every control point inside the documented box", () => {
    // The header promises 0.58r horizontally and 1.1r vertically; Bezier curves
    // stay inside the convex hull of their control points, so bounding the
    // points bounds the drawn curve. Callers size the face against this.
    for (const v of VALUES) {
      for (const [x, y] of trace(v).pts) {
        expect(Math.abs(x), `digit ${v} x`).toBeLessThanOrEqual(0.58);
        expect(Math.abs(y), `digit ${v} y`).toBeLessThanOrEqual(1.1);
      }
    }
  });

  it("stays inside the face once the stroke is inked on, at the shipped size", () => {
    // The real constraint is the INKED glyph at NUMERAL_FACE_R, not the bare
    // centerline at r=1: the keyline pass is the widest thing drawn, reaching
    // half its width beyond every control point. A face spans 1 unit either
    // side of center in face-local coords, and its corners are rounded at 24%,
    // so clearing 1.0 flat is the check that matters.
    const half = (NUMERAL_FACE_R * NUMERAL_STROKE * NUMERAL_KEYLINE) / 2;
    for (const v of VALUES) {
      for (const [x, y] of trace(v, 0, 0, NUMERAL_FACE_R).pts) {
        expect(Math.abs(x) + half, `digit ${v} x`).toBeLessThan(1);
        expect(Math.abs(y) + half, `digit ${v} y`).toBeLessThan(1);
      }
    }
  });

  it("gives each value a distinguishable glyph", () => {
    const shapes = new Set(VALUES.map((v) => JSON.stringify(trace(v).pts)));
    expect(shapes.size).toBe(VALUES.length);
  });

  it("translates and scales about the center it is given", () => {
    for (const v of VALUES) {
      const base = trace(v).pts;
      const moved = trace(v, 10, -4).pts;
      const scaled = trace(v, 0, 0, 3).pts;
      expect(moved.length).toBe(base.length);
      base.forEach(([x, y], i) => {
        expect(moved[i]![0]).toBeCloseTo(x + 10, 10);
        expect(moved[i]![1]).toBeCloseTo(y - 4, 10);
        expect(scaled[i]![0]).toBeCloseTo(x * 3, 10);
        expect(scaled[i]![1]).toBeCloseTo(y * 3, 10);
      });
    }
  });

  it("uses a keyline wider than the ink it sits under", () => {
    // If these ever cross, the darker under-stroke stops being a rim and
    // becomes the glyph — the numeral would render in the wrong color.
    expect(NUMERAL_KEYLINE).toBeGreaterThan(1);
    expect(NUMERAL_STROKE).toBeGreaterThan(0);
  });
});
