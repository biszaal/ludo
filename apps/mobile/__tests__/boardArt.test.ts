/**
 * Board art is generated geometry drawn into the board's cached picture, so the
 * two ways it can hurt are silently: by escaping the surface it was generated
 * for (a vein across the pawns), or by growing without bound on a big screen
 * (a picture that takes a visible beat to record on a weak device — the exact
 * thing Board.tsx's two-canvas split exists to avoid).
 *
 * The third check is the one that caught a real bug: a texture asked to print
 * on a yard plate a third the board's width came back with a ninth of the
 * elements at a third the size — present, and invisible. TextureFit is what
 * fixes that, so it is tested rather than trusted.
 */

import { describe, expect, it } from "vitest";
import { artSeed, frameBand, plateTexture, yardEmblem, type Art, type BandKind, type EmblemKind, type TextureKind } from "../src/render/boardArt";

const TEXTURES: TextureKind[] = ["grain", "veins", "foliage", "starfield", "ripple", "damask"];
const BANDS: BandKind[] = ["meander", "rope", "pearls", "laurel", "chevron", "rays"];
const EMBLEMS: EmblemKind[] = ["rose", "wreath", "medallion", "constellation", "lattice", "rings"];

/** Every element in an Art bundle, as (x, y) points plus its extent. */
function extents(art: Art): Array<{ x: number; y: number; r: number }> {
  return [
    ...art.dots.map((d) => ({ x: d.x, y: d.y, r: d.r })),
    ...art.marks.map((m) => ({ x: m.x, y: m.y, r: m.r })),
    ...art.motifs.map((m) => ({ x: m.x, y: m.y, r: m.r })),
    ...art.strokes.flatMap((s) => s.pts.map(([x, y]) => ({ x, y, r: s.w }))),
  ];
}

function elementCount(art: Art): number {
  return art.dots.length + art.marks.length + art.strokes.length + art.motifs.length;
}

describe("plate textures", () => {
  it("are deterministic for a given seed", () => {
    for (const kind of TEXTURES) {
      const a = plateTexture(kind, artSeed("theme", kind), 340);
      const b = plateTexture(kind, artSeed("theme", kind), 340);
      expect(JSON.stringify(a), kind).toBe(JSON.stringify(b));
    }
  });

  it("gives different boards different fields", () => {
    const a = plateTexture("foliage", artSeed("garden", "foliage"), 340);
    const b = plateTexture("foliage", artSeed("moonlit", "foliage"), 340);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("stays near the surface it was generated for", () => {
    // Textures are clipped when drawn, so a small overhang is intended (a vein
    // has to enter from off-plate to look like it runs through the stone). What
    // must not happen is art landing a whole surface away.
    for (const kind of TEXTURES) {
      for (const { x, y, r } of extents(plateTexture(kind, artSeed("t", kind), 300))) {
        expect(x + r, kind).toBeGreaterThan(-300 * 0.35);
        expect(x - r, kind).toBeLessThan(300 * 1.35);
        expect(y + r, kind).toBeGreaterThan(-300 * 0.35);
        expect(y - r, kind).toBeLessThan(300 * 1.35);
      }
    }
  });

  it("keeps element counts bounded as the board grows", () => {
    // Per-area density with a hard cap: a tablet must not turn a 60-element
    // texture into a 600-element one.
    for (const kind of TEXTURES) {
      const small = elementCount(plateTexture(kind, 1, 64));
      const phone = elementCount(plateTexture(kind, 1, 340));
      const tablet = elementCount(plateTexture(kind, 1, 1200));
      expect(small, kind).toBeLessThanOrEqual(phone);
      expect(tablet, kind).toBeLessThanOrEqual(phone * 2);
      expect(phone, kind).toBeLessThan(400);
    }
  });

  it("prints the same field, not a shrunken one, on a small surface", () => {
    // The yard-inlay bug: same texture, third the width, and it came back with
    // a ninth of the elements at a third the size. TextureFit restores both.
    const plate = plateTexture("foliage", 7, 340);
    const bare = plateTexture("foliage", 7, 118);
    const fitted = plateTexture("foliage", 7, 118, { density: 3.5, scale: 2.6 });

    expect(elementCount(bare)).toBeLessThan(elementCount(plate) / 4);
    expect(elementCount(fitted)).toBeGreaterThan(elementCount(bare) * 2);

    // And the elements are a comparable FRACTION of their surface.
    const frac = (art: Art, size: number) => Math.max(...art.marks.map((m) => m.r)) / size;
    expect(frac(fitted, 118)).toBeGreaterThan(frac(plate, 340) * 0.8);
    expect(frac(fitted, 118)).toBeLessThan(frac(plate, 340) * 3);
  });
});

describe("frame bands", () => {
  const SIZE = 340;
  const INSET = SIZE * 0.014;
  const WIDTH = SIZE * 0.021;

  it("stays inside the band it was given, on all four edges", () => {
    // The band runs in the clear plate between the rim lip and the first yard
    // tile. Overshoot either way is ornament drawn under the play area.
    for (const kind of BANDS) {
      const art = frameBand(kind, SIZE, INSET, WIDTH);
      expect(elementCount(art), kind).toBeGreaterThan(3);
      for (const { x, y, r } of extents(art)) {
        const fromEdge = Math.min(x, y, SIZE - x, SIZE - y);
        expect(fromEdge + r, `${kind} at ${x},${y}`).toBeGreaterThanOrEqual(INSET - WIDTH * 0.6);
        expect(fromEdge - r, `${kind} at ${x},${y}`).toBeLessThanOrEqual(INSET + WIDTH * 1.6);
      }
    }
  });

  it("covers all four edges", () => {
    for (const kind of BANDS) {
      const pts = extents(frameBand(kind, SIZE, INSET, WIDTH));
      const mid = SIZE / 2;
      const near = (v: number) => v < INSET + WIDTH * 1.6;
      expect(pts.some((p) => near(p.y) && Math.abs(p.x - mid) < mid * 0.5), `${kind} top`).toBe(true);
      expect(pts.some((p) => near(SIZE - p.y) && Math.abs(p.x - mid) < mid * 0.5), `${kind} bottom`).toBe(true);
      expect(pts.some((p) => near(p.x) && Math.abs(p.y - mid) < mid * 0.5), `${kind} left`).toBe(true);
      expect(pts.some((p) => near(SIZE - p.x) && Math.abs(p.y - mid) < mid * 0.5), `${kind} right`).toBe(true);
    }
  });

  it("fits a whole number of repeats per edge", () => {
    // An ornament that runs off mid-motif is the tell of a texture stretched to
    // fit, so the period is adjusted to divide the run exactly. Checked through
    // the count: it must be stable for a given geometry, not size-dependent
    // noise, and it must not collapse to one unit on a small board.
    for (const kind of BANDS) {
      const a = elementCount(frameBand(kind, SIZE, INSET, WIDTH));
      const b = elementCount(frameBand(kind, SIZE, INSET, WIDTH));
      expect(a, kind).toBe(b);
      expect(elementCount(frameBand(kind, 64, 64 * 0.014, 64 * 0.021)), `${kind} thumbnail`).toBeGreaterThan(3);
    }
  });

  it("returns nothing rather than garbage when the band cannot fit", () => {
    expect(elementCount(frameBand("meander", 10, 4, 4))).toBe(0);
  });
});

describe("yard emblems", () => {
  it("fit inside the plate they are printed on", () => {
    // A FIGURE — a parterre, a wreath, a medallion, a chart — must sit inside
    // the plate on its own, not rely on the clip: one that runs to the edge is
    // one the pawns are standing on. "lattice" is exempt and only checked for
    // sanity, because a trellis is a repeating field and cloth that stops short
    // of the hem looks like a mistake; it is meant to be cut by the clip.
    for (const kind of EMBLEMS) {
      const art = yardEmblem(kind, 120);
      expect(elementCount(art), kind).toBeGreaterThan(2);
      const slack = kind === "lattice" ? 120 : 1;
      for (const { x, y, r } of extents(art)) {
        expect(x + r, kind).toBeGreaterThanOrEqual(-slack);
        expect(x - r, kind).toBeLessThanOrEqual(120 + slack);
        expect(y + r, kind).toBeGreaterThanOrEqual(-slack);
        expect(y - r, kind).toBeLessThanOrEqual(120 + slack);
      }
    }
  });

  it("are composed, not seeded — the same figure every time, with no PRNG", () => {
    for (const kind of EMBLEMS) {
      expect(JSON.stringify(yardEmblem(kind, 120)), kind).toBe(JSON.stringify(yardEmblem(kind, 120)));
    }
  });

  it("stay legible: few enough elements to read as one figure", () => {
    // The emblem replaced a scattered texture precisely because thirty-odd
    // random marks read as dirt. A cap is the mechanical version of that rule.
    for (const kind of EMBLEMS) {
      expect(elementCount(yardEmblem(kind, 120)), kind).toBeLessThan(50);
    }
  });

  it("are centred figures", () => {
    // Symmetry is what the eye reads as "designed" — so the ink has to sit
    // around the middle, not drift to a corner. (A constellation is a chart,
    // deliberately off-axis, so it gets more room.)
    for (const kind of EMBLEMS) {
      const pts = extents(yardEmblem(kind, 120));
      const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
      const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      const slack = kind === "constellation" ? 22 : 6;
      expect(Math.abs(cx - 60), `${kind} x`).toBeLessThan(slack);
      expect(Math.abs(cy - 60), `${kind} y`).toBeLessThan(slack);
    }
  });

  it("scales with the plate", () => {
    const small = yardEmblem("rose", 60);
    const big = yardEmblem("rose", 120);
    expect(elementCount(small)).toBe(elementCount(big));
    expect(big.marks[0]!.r).toBeCloseTo(small.marks[0]!.r * 2, 6);
  });
});
