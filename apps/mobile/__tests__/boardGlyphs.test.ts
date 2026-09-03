/**
 * The safe/start-square markings are drawn 6-12px wide inside a cell that is
 * already laid out, so the only two things that can break a board are a glyph
 * that spills out of its cell and a glyph that isn't a closed shape (Skia fills
 * an unclosed subpath, but the implied closing edge is rarely the one intended).
 * Both are checked here for every glyph, on the same convex-hull argument
 * pipShapes.test.ts uses: bound the control points and the curve is bounded.
 */

import { describe, expect, it } from "vitest";
import { appendGlyph, type BoardGlyph } from "../src/render/boardGlyphs";

const GLYPHS: BoardGlyph[] = ["star", "leaf", "blossom", "lozenge", "fleur", "sunburst"];

interface Rec {
  /** Every coordinate handed to the sink, control points included. */
  pts: Array<[number, number]>;
  /** The figure as actually drawn — curves flattened by sampling. */
  drawn: Array<[number, number]>;
  moves: number;
  closes: number;
}

function record(glyph: BoardGlyph, cx: number, cy: number, r: number): Rec {
  const rec: Rec = { pts: [], drawn: [], moves: 0, closes: 0 };
  const push = (...xy: number[]) => {
    for (let i = 0; i < xy.length; i += 2) rec.pts.push([xy[i]!, xy[i + 1]!]);
  };
  // A cubic bulges out toward its control points but never reaches them, so
  // bounding the hull would either fail a perfectly well-behaved petal or force
  // the geometry flat. Sample the curve instead and bound what is painted.
  let cur: [number, number] = [0, 0];
  const at = (p0: number, p1: number, p2: number, p3: number, t: number) => {
    const u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
  };
  appendGlyph(
    {
      moveTo: (x, y) => {
        rec.moves++;
        push(x, y);
        cur = [x, y];
        rec.drawn.push([x, y]);
      },
      lineTo: (x, y) => {
        push(x, y);
        cur = [x, y];
        rec.drawn.push([x, y]);
      },
      cubicTo: (a, b, c, d, e, f) => {
        push(a, b, c, d, e, f);
        for (let i = 1; i <= 24; i++) {
          const t = i / 24;
          rec.drawn.push([at(cur[0], a, c, e, t), at(cur[1], b, d, f, t)]);
        }
        cur = [e, f];
      },
      close: () => {
        rec.closes++;
      },
    },
    glyph,
    cx,
    cy,
    r,
  );
  return rec;
}

describe("board glyphs", () => {
  it("every glyph stays inside the cell box it was sized for", () => {
    for (const glyph of GLYPHS) {
      const { drawn, pts } = record(glyph, 40, 25, 8);
      expect(drawn.length, glyph).toBeGreaterThan(2);
      for (const [x, y] of drawn) {
        expect(Math.hypot(x - 40, y - 25), `${glyph} drawn at ${x},${y}`).toBeLessThanOrEqual(8 * 1.02 + 1e-9);
      }
      // Control points may reach past the figure, but only so far: a glyph
      // whose handles fly off is one edit away from spilling into the track.
      for (const [x, y] of pts) {
        expect(Math.hypot(x - 40, y - 25), `${glyph} control at ${x},${y}`).toBeLessThanOrEqual(8 * 1.4 + 1e-9);
      }
    }
  });

  it("fills the cell it is given — a mark half the size of the star reads as dirt", () => {
    for (const glyph of GLYPHS) {
      const reach = Math.max(...record(glyph, 0, 0, 10).drawn.map(([x, y]) => Math.hypot(x, y)));
      expect(reach, glyph).toBeGreaterThan(9);
    }
  });

  it("every glyph closes every subpath it opens", () => {
    for (const glyph of GLYPHS) {
      const { moves, closes } = record(glyph, 0, 0, 10);
      expect(moves, glyph).toBeGreaterThan(0);
      expect(closes, glyph).toBe(moves);
    }
  });

  it("scales and translates linearly — the same figure at any cell size", () => {
    // A glyph that drifts off-center as the board grows would be invisible in
    // the 64px shop thumbnail and wrong in the 340px board, or vice versa.
    const small = record("fleur", 0, 0, 1).pts;
    const big = record("fleur", 100, -30, 4).pts;
    expect(big).toHaveLength(small.length);
    for (let i = 0; i < small.length; i++) {
      expect(big[i]![0]).toBeCloseTo(100 + small[i]![0]! * 4, 9);
      expect(big[i]![1]).toBeCloseTo(-30 + small[i]![1]! * 4, 9);
    }
  });

  it("is deterministic — ornament that wobbles reads as damage, not design", () => {
    expect(record("blossom", 5, 5, 3).pts).toEqual(record("blossom", 5, 5, 3).pts);
  });
});
