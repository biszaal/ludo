/**
 * The marking struck into a board's start and safe squares — the classic five-
 * point star, or, on the premium tiers, a leaf, a blossom, a lozenge, a
 * fleur-de-lis, a deco sunburst.
 *
 * Why a theme gets to change this at all, when boardThemes.ts's rule is that a
 * theme restyles surfaces and never touches geometry: the rule is about the
 * BOARD — cell positions, sizes, the reachable layout, the animation timing.
 * None of that moves here. A glyph is a marking painted inside a cell that is
 * already exactly where it was, in the same way a dice skin inks a crown
 * instead of a dot without changing what a 4 means (render/pipShapes.ts). It is
 * also the cheapest way for a board to stop being a recolor: 0059's lesson was
 * that a prestige tier assembled out of tinted copies is the first one players
 * stop believing in, and a garden board whose safe squares carry leaves is a
 * different object from a garden-tinted classic board.
 *
 * Pure geometry, dependency-free, unit-tested in Node — same discipline as
 * pipShapes.ts and faceMotifs.ts. Unlike those two this never runs inside a
 * worklet (the board's static surface is recorded on the JS thread, once per
 * size + theme), but it keeps the same self-contained shape anyway so it could.
 */

export type BoardGlyph = "star" | "leaf" | "blossom" | "lozenge" | "fleur" | "sunburst";

/** The subset of SkPath these glyphs need. A real SkPath satisfies it. */
export interface GlyphSink {
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): unknown;
  close(): unknown;
}

/**
 * Appends `glyph` centered on (cx, cy) at radius `r`.
 *
 * The DRAWN figure stays within r of the center (1.02r, for rounding), so a
 * caller can drop any glyph into the same cell box it already sized for the
 * star and get something that fits. Control points may reach further — a petal
 * has to be pulled from outside itself to bulge — but never past 1.4r. Both
 * bounds are checked in __tests__/boardGlyphs.test.ts, the drawn one by
 * flattening the curves rather than by trusting their hulls.
 *
 * These are drawn small — a safe-square mark is ~0.28 of a cell, so 6-12px on a
 * phone — so each shape is built out of as few curves as will still read at
 * that size. Detail that dissolves into a smudge is worse than no detail.
 */
export function appendGlyph(sink: GlyphSink, glyph: BoardGlyph, cx: number, cy: number, r: number, rot = 0): void {
  // Rotation is applied by wrapping the sink rather than by threading an angle
  // through every shape below: a proxy that spins each coordinate about the
  // centre before forwarding it is exact for straight segments and for Beziers
  // alike (rotating the control points rotates the curve), and it leaves the
  // shapes themselves written in the frame they were designed in. Scattered
  // foliage needs free rotation (render/boardArt.ts); a safe-square mark does
  // not, and passes 0.
  if (rot !== 0) {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const rx = (x: number, y: number) => cx + (x - cx) * c - (y - cy) * s;
    const ry = (x: number, y: number) => cy + (x - cx) * s + (y - cy) * c;
    const outer = sink;
    sink = {
      moveTo: (x, y) => outer.moveTo(rx(x, y), ry(x, y)),
      lineTo: (x, y) => outer.lineTo(rx(x, y), ry(x, y)),
      cubicTo: (a, b, c2, d, e, f) =>
        outer.cubicTo(rx(a, b), ry(a, b), rx(c2, d), ry(c2, d), rx(e, f), ry(e, f)),
      close: () => outer.close(),
    };
  }
  const X = (u: number) => cx + u * r;
  const Y = (v: number) => cy + v * r;

  switch (glyph) {
    case "star": {
      // The original board star, kept here so callers can treat the glyph set
      // as total. Board.tsx still draws the untouched themes through its own
      // starPath() with their exact historical radii.
      const points = 5;
      for (let i = 0; i < points * 2; i++) {
        const radius = i % 2 === 0 ? 1 : 0.43;
        const a = (Math.PI * i) / points - Math.PI / 2;
        const x = cx + Math.cos(a) * radius * r;
        const y = cy + Math.sin(a) * radius * r;
        if (i === 0) sink.moveTo(x, y);
        else sink.lineTo(x, y);
      }
      sink.close();
      return;
    }

    case "leaf": {
      // An almond pointed at both ends, tilted off the vertical so a grid of
      // them reads as foliage rather than as a row of identical decals.
      const cos = Math.cos(-Math.PI / 5);
      const sin = Math.sin(-Math.PI / 5);
      const px = (u: number, v: number) => cx + (u * cos - v * sin) * r;
      const py = (u: number, v: number) => cy + (u * sin + v * cos) * r;
      sink.moveTo(px(0, -1), py(0, -1));
      sink.cubicTo(px(0.6, -0.45), py(0.6, -0.45), px(0.6, 0.45), py(0.6, 0.45), px(0, 1), py(0, 1));
      sink.cubicTo(px(-0.6, 0.45), py(-0.6, 0.45), px(-0.6, -0.45), py(-0.6, -0.45), px(0, -1), py(0, -1));
      sink.close();
      return;
    }

    case "blossom": {
      // Five lobes, valley to valley in one cubic each. Petal count is odd on
      // purpose: an even one lines up with the cell's own edges and starts
      // looking like a compass rose.
      //
      // The valleys sit high (0.46) and the handles wide-set (±0.42rad) because the
      // first cut of this glyph used 0.34/1.30 and read as an asterisk at cell
      // size: deep valleys and long handles make five spikes, not five petals.
      // Shallow valleys and wide-set handles make the lobes touch, which is
      // what the eye needs to see a flower at 8px; the handles still reach 1.25
      // so the petals fill the cell the star used to.
      const petals = 5;
      const step = (Math.PI * 2) / petals;
      const valley = (a: number) => ({ x: cx + Math.cos(a) * 0.46 * r, y: cy + Math.sin(a) * 0.46 * r });
      const first = valley(-Math.PI / 2 - step / 2);
      sink.moveTo(first.x, first.y);
      for (let i = 0; i < petals; i++) {
        const a = -Math.PI / 2 + i * step;
        const c1a = a - 0.42;
        const c2a = a + 0.42;
        const end = valley(a + step / 2);
        sink.cubicTo(
          cx + Math.cos(c1a) * 1.25 * r,
          cy + Math.sin(c1a) * 1.25 * r,
          cx + Math.cos(c2a) * 1.25 * r,
          cy + Math.sin(c2a) * 1.25 * r,
          end.x,
          end.y,
        );
      }
      sink.close();
      return;
    }

    case "lozenge": {
      // A cut stone seen face on: a tall rhombus with barely convex sides, so
      // the edges catch as facets rather than reading as a flat diamond.
      sink.moveTo(X(0), Y(-1));
      sink.cubicTo(X(0.3), Y(-0.62), X(0.52), Y(-0.24), X(0.56), Y(0));
      sink.cubicTo(X(0.52), Y(0.24), X(0.3), Y(0.62), X(0), Y(1));
      sink.cubicTo(X(-0.3), Y(0.62), X(-0.52), Y(0.24), X(-0.56), Y(0));
      sink.cubicTo(X(-0.52), Y(-0.24), X(-0.3), Y(-0.62), X(0), Y(-1));
      sink.close();
      return;
    }

    case "fleur": {
      // Four filled sub-paths — center petal, two side lobes, band. They union
      // under a nonzero fill, which is far easier to keep symmetric than one
      // continuous outline traced around all of it.
      sink.moveTo(X(0), Y(-1));
      sink.cubicTo(X(0.3), Y(-0.66), X(0.26), Y(-0.22), X(0.11), Y(0.06));
      sink.lineTo(X(-0.11), Y(0.06));
      sink.cubicTo(X(-0.26), Y(-0.22), X(-0.3), Y(-0.66), X(0), Y(-1));
      sink.close();

      sink.moveTo(X(0.1), Y(-0.06));
      sink.cubicTo(X(0.54), Y(-0.42), X(0.98), Y(-0.06), X(0.68), Y(0.2));
      sink.cubicTo(X(0.5), Y(0.34), X(0.26), Y(0.26), X(0.12), Y(0.08));
      sink.close();

      sink.moveTo(X(-0.1), Y(-0.06));
      sink.cubicTo(X(-0.54), Y(-0.42), X(-0.98), Y(-0.06), X(-0.68), Y(0.2));
      sink.cubicTo(X(-0.5), Y(0.34), X(-0.26), Y(0.26), X(-0.12), Y(0.08));
      sink.close();

      sink.moveTo(X(-0.54), Y(0.22));
      sink.lineTo(X(0.54), Y(0.22));
      sink.lineTo(X(0.44), Y(0.44));
      sink.lineTo(X(-0.44), Y(0.44));
      sink.close();

      // The foot flares to 0.22 wide, so it stops at 0.97 rather than 1: the
      // corner is the farthest point of the whole glyph, and at y = 1 it is the
      // one place a fleur pokes out of the circle every other glyph fits in.
      sink.moveTo(X(-0.16), Y(0.44));
      sink.lineTo(X(0.16), Y(0.44));
      sink.lineTo(X(0.22), Y(0.97));
      sink.lineTo(X(-0.22), Y(0.97));
      sink.close();
      return;
    }

    case "sunburst": {
      // Eight rays of two lengths — the long ones on the cardinals, short ones
      // between. The alternation is what makes it deco rather than a gear.
      const spikes = 8;
      for (let i = 0; i < spikes * 2; i++) {
        const long = Math.floor(i / 2) % 2 === 0;
        const radius = i % 2 === 0 ? (long ? 1 : 0.66) : 0.3;
        const a = (Math.PI * i) / spikes - Math.PI / 2;
        const x = cx + Math.cos(a) * radius * r;
        const y = cy + Math.sin(a) * radius * r;
        if (i === 0) sink.moveTo(x, y);
        else sink.lineTo(x, y);
      }
      sink.close();
      return;
    }
  }
}
