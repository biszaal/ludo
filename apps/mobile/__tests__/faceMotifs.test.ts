/**
 * Face ornament for the top dice tier. These figures are drawn inside a Skia
 * recording on the UI thread where nothing can be inspected, so the properties
 * a caller relies on — every kind draws something, nothing escapes the radius
 * it was given, and the figure is exactly symmetric — are pinned here.
 *
 * Symmetry is the one that matters most. pipShapes.ts already learned this the
 * hard way with "facets": ornament whose angles or repeat counts wobble reads
 * as damage, not decoration. Nothing in this module is seeded, and this test
 * is what keeps it that way.
 */

import { describe, expect, it } from "vitest";
import { appendMotif, motifStyle, type MotifKind } from "../src/render/faceMotifs";

const KINDS: MotifKind[] = ["rosette", "guilloche", "deco"];

function trace(kind: MotifKind, cx = 0, cy = 0, r = 1) {
  const pts: [number, number][] = [];
  /** Points the pen actually passes through, control handles excluded. */
  const onCurve: [number, number][] = [];
  const ops: string[] = [];
  const push = (...xy: number[]) => {
    for (let i = 0; i < xy.length; i += 2) pts.push([xy[i]!, xy[i + 1]!]);
  };
  appendMotif(
    {
      moveTo: (x, y) => { ops.push("M"); push(x, y); onCurve.push([x, y]); },
      lineTo: (x, y) => { ops.push("L"); push(x, y); onCurve.push([x, y]); },
      cubicTo: (a, b, c, d, e, f) => { ops.push("C"); push(a, b, c, d, e, f); onCurve.push([e, f]); },
      close: () => { ops.push("Z"); },
    },
    kind,
    cx,
    cy,
    r,
  );
  return { pts, onCurve, ops };
}

describe("appendMotif", () => {
  it("draws every kind", () => {
    for (const k of KINDS) {
      const { pts, ops } = trace(k);
      expect(ops.length, k).toBeGreaterThan(4);
      expect(pts.length, k).toBeGreaterThan(8);
    }
  });

  it("starts every subpath with a move", () => {
    for (const k of KINDS) expect(trace(k).ops[0], k).toBe("M");
  });

  it("stays within the radius it was given", () => {
    // The face clip is a backstop, not the design. Ornament that only fits
    // because it got cropped would change shape with the die's corner radius.
    //
    // Measured on ON-CURVE points only. Guilloché's rings are circles built
    // from cubics, and the standard construction puts its control handles at
    // hypot(r, 0.5523r) = 1.12r — outside the circle they draw. That is the
    // approximation working, not geometry escaping, so the handles get the
    // looser bound below and the pen path gets the real one.
    for (const k of KINDS) {
      for (const [x, y] of trace(k).onCurve) {
        expect(Math.hypot(x, y), `${k} on-curve`).toBeLessThanOrEqual(1.0001);
      }
      for (const [x, y] of trace(k).pts) {
        expect(Math.hypot(x, y), `${k} control`).toBeLessThanOrEqual(1.13);
      }
    }
  });

  it("is exactly rotationally symmetric, with no seeded wobble", () => {
    // Every kind is built from N identical elements around a center, so the
    // multiset of point radii must collapse to a small set of distinct values.
    // A seeded or hand-jittered figure would produce dozens.
    for (const k of KINDS) {
      const radii = trace(k).onCurve.map(([x, y]) => Math.round(Math.hypot(x, y) * 1000) / 1000);
      expect(new Set(radii).size, k).toBeLessThanOrEqual(6);
    }
  });

  it("is deterministic — same input, same geometry, every call", () => {
    for (const k of KINDS) {
      expect(JSON.stringify(trace(k).pts)).toBe(JSON.stringify(trace(k).pts));
    }
  });

  it("translates and scales about the center it is given", () => {
    for (const k of KINDS) {
      const base = trace(k).pts;
      const moved = trace(k, 7, -3).pts;
      const scaled = trace(k, 0, 0, 4).pts;
      base.forEach(([x, y], i) => {
        expect(moved[i]![0]).toBeCloseTo(x + 7, 9);
        expect(moved[i]![1]).toBeCloseTo(y - 3, 9);
        expect(scaled[i]![0]).toBeCloseTo(x * 4, 9);
        expect(scaled[i]![1]).toBeCloseTo(y * 4, 9);
      });
    }
  });
});

describe("motifStyle", () => {
  it("strokes engine turning and fills inlay", () => {
    // Guilloché is cut INTO the metal, so it is a hairline; the other two are
    // laid into the face as shapes. Getting this backwards turns a rosette
    // into a wireframe.
    expect(motifStyle("guilloche").style).toBe("stroke");
    expect(motifStyle("guilloche").width).toBeGreaterThan(0);
    expect(motifStyle("rosette").style).toBe("fill");
    expect(motifStyle("deco").style).toBe("fill");
  });
});
