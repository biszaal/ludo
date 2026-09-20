/**
 * A board has to be the same board at every size it is drawn.
 *
 * It is drawn at four very different scales — ~354pt in play, 176pt in the
 * Shop's hero preview, 64pt in the Shop's grid thumbnail, and 64pt again in
 * the quick-setup sheet — and the shop's whole job is to show a player what
 * they would be buying. A measurement written as a pixel constant instead of a
 * fraction of the board breaks that silently: it looks right at the size it
 * was tuned for and wrong everywhere else, with no error and nothing to see
 * unless you happen to compare the thumbnail against the real thing.
 *
 * Which is exactly what happened. The yard radii were `r={16}` and `r={12}`.
 * On a full-size board a yard is ~136pt, so 16 is a gentle round. In a 64pt
 * thumbnail a yard is ~25pt, so 16 exceeds half the side, Skia clamps it to
 * w/2, and the square yard renders as a circle — meaning every "solid" board
 * advertised itself in the shop with the round yards of a "disc" board.
 */

import { describe, it, expect } from "vitest";
import { cellSize, yardGeometry } from "../src/render/boardLayout";

/** Every size the app actually draws a board at. */
const SIZES = [354, 176, 64, 230, 600];

describe("yard geometry", () => {
  it("keeps the yard the same shape at every board size", () => {
    const ratios = SIZES.map((size) => {
      const g = yardGeometry(cellSize(size));
      return {
        size,
        r: g.r / g.w,
        lipR: g.lipR / g.w,
        bandR: g.bandR / g.w,
        innerR: g.innerR / g.iw,
        drop: g.drop / g.w,
      };
    });
    const [first, ...rest] = ratios;
    for (const r of rest) {
      for (const key of ["r", "lipR", "bandR", "innerR", "drop"] as const) {
        expect(r[key], `${key} differs between a ${first!.size}pt and a ${r.size}pt board`).toBeCloseTo(first![key], 10);
      }
    }
  });

  // The failure mode itself, stated directly: a rounded rect whose radius
  // reaches half its side IS a circle, whatever the theme asked for.
  it("never rounds a yard into a circle, however small the board", () => {
    for (const size of [40, 64, 96, 176, 354, 600]) {
      const g = yardGeometry(cellSize(size));
      expect(g.r / g.w, `a ${size}pt board rounds its yard into a circle`).toBeLessThan(0.25);
      expect(g.innerR / g.iw, `a ${size}pt board rounds its yard plate into a circle`).toBeLessThan(0.25);
    }
  });

  // Pins the in-game look: this refactor was supposed to change what the
  // SMALL boards do, and leave the board people actually play on alone.
  it("reproduces the original pixel radii on a full-size board", () => {
    const g = yardGeometry(cellSize(354));
    expect(g.r).toBeCloseTo(16, 0);
    expect(g.lipR).toBeCloseTo(14, 0);
    expect(g.bandR).toBeCloseTo(13, 0);
    expect(g.innerR).toBeCloseTo(12, 0);
  });

  it("keeps the inset plate inside the tile", () => {
    for (const size of SIZES) {
      const g = yardGeometry(cellSize(size));
      expect(g.iw).toBeLessThan(g.w);
      expect(g.w).toBeGreaterThan(0);
    }
  });
});
