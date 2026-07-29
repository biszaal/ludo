/**
 * Cosmetic dice-pip glyphs and decorative face overlays for skinned dice —
 * pure path geometry, worklet-safe (it runs inside Dice.tsx's per-frame Skia
 * recording, on the UI thread) and dependency-free so it unit-tests in Node,
 * same discipline as dieMath.ts. "dot" pips are deliberately not built here:
 * callers keep drawing those as a plain `canvas.drawCircle` — cheaper, and
 * exactly what every skin drew before cosmetics existed.
 *
 * Each exported function is fully self-contained — no calls to a sibling
 * top-level function in this file. Reanimated's worklet transform rewrites a
 * `"worklet"`-tagged function declaration in a way that loses plain JS's
 * function-hoisting guarantee, so one such function calling ANOTHER one
 * declared later in the same file can resolve to undefined at runtime (only
 * visible in the real Metro/Reanimated bundle — vitest never applies that
 * transform, so the bug was invisible to every test here). dieMath.ts's
 * functions are never actually exercised this way: they're called from a
 * worklet in a *different* file (Dice.tsx), which is the pattern that's
 * proven safe. Any shared logic below is inlined or nested as a local
 * closure instead — mirroring how Dice.tsx nests its own `mix()` helper
 * inside the worklet that uses it, rather than calling out to a neighbor.
 */

export type PipShape = "dot" | "heart" | "star" | "diamond" | "crown" | "flame";
export type OverlayKind = "stars" | "veins" | "grain" | "facets";

/** The subset of SkPath's surface these glyphs need. A real SkPath (built
 *  inside the worklet or on the JS thread for a static preview) satisfies
 *  this structurally — no adapter required. */
export interface PathSink {
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  quadTo(cx: number, cy: number, x: number, y: number): unknown;
  cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): unknown;
  close(): unknown;
}

/** Appends one pip glyph centered at (cx, cy) with radius r into `sink`. Every
 *  shape's control points stay within 1.1r of the center (Bezier curves are
 *  contained in the convex hull of their control points, so bounding those
 *  bounds the drawn curve too) — callers can lay these out on the same grid
 *  as the plain dot pips without extra clearance math. */
export function appendPip(sink: PathSink, shape: Exclude<PipShape, "dot">, cx: number, cy: number, r: number): void {
  "worklet";
  const X = (u: number) => cx + u * r;
  const Y = (v: number) => cy + v * r;

  switch (shape) {
    case "heart": {
      sink.moveTo(X(0), Y(0.8));
      sink.cubicTo(X(-1.0), Y(0.25), X(-0.75), Y(-0.55), X(-0.32), Y(-0.7));
      sink.cubicTo(X(-0.05), Y(-0.82), X(0), Y(-0.55), X(0), Y(-0.42));
      sink.cubicTo(X(0), Y(-0.55), X(0.05), Y(-0.82), X(0.32), Y(-0.7));
      sink.cubicTo(X(0.75), Y(-0.55), X(1.0), Y(0.25), X(0), Y(0.8));
      sink.close();
      return;
    }
    case "star": {
      const spikes = 5;
      const outerR = r;
      const innerR = r * 0.42;
      const rot = -Math.PI / 2; // first tip points straight up
      for (let i = 0; i < spikes * 2; i++) {
        const rad = i % 2 === 0 ? outerR : innerR;
        const angle = rot + (i * Math.PI) / spikes;
        const x = cx + Math.cos(angle) * rad;
        const y = cy + Math.sin(angle) * rad;
        if (i === 0) sink.moveTo(x, y);
        else sink.lineTo(x, y);
      }
      sink.close();
      return;
    }
    case "diamond": {
      sink.moveTo(X(0), Y(-1));
      sink.lineTo(X(0.62), Y(-0.15));
      sink.lineTo(X(0), Y(1));
      sink.lineTo(X(-0.62), Y(-0.15));
      sink.close();
      return;
    }
    case "crown": {
      sink.moveTo(X(-0.82), Y(0.65));
      sink.lineTo(X(-0.55), Y(-0.75));
      sink.lineTo(X(-0.26), Y(0.05));
      sink.lineTo(X(0), Y(-0.85));
      sink.lineTo(X(0.26), Y(0.05));
      sink.lineTo(X(0.55), Y(-0.75));
      sink.lineTo(X(0.82), Y(0.65));
      sink.close();
      return;
    }
    case "flame": {
      sink.moveTo(X(0), Y(0.9));
      sink.cubicTo(X(-0.75), Y(0.55), X(-0.6), Y(-0.15), X(-0.18), Y(-0.55));
      sink.cubicTo(X(-0.5), Y(-0.85), X(-0.15), Y(-1.05), X(0.05), Y(-0.85));
      sink.cubicTo(X(0.3), Y(-0.6), X(0.05), Y(-0.4), X(0.15), Y(-0.15));
      sink.cubicTo(X(0.55), Y(-0.05), X(0.65), Y(0.55), X(0), Y(0.9));
      sink.close();
      return;
    }
  }
}

// --- Deterministic decorative overlays --------------------------------------
// A cheap static "texture" pass drawn once per landing over the flat face —
// dots and short strokes in unit-square [0,1]² coords, which the caller scales
// onto the face rect. Seeded so the same skin always looks the same (no
// shimmer between recordings), varied so different skins don't share a look.

export interface OverlayDot {
  x: number;
  y: number;
  r: number;
  a: number;
}
export interface OverlayStroke {
  pts: [number, number][];
  w: number;
  a: number;
}
export interface OverlayArt {
  dots: OverlayDot[];
  strokes: OverlayStroke[];
}

/** Deterministic 32-bit PRNG (mulberry32) — same seed, same sequence, on every
 *  platform (unlike Math.random, which the UI-thread worklet can't use
 *  anyway). Exported standalone for its own unit tests; overlayArt below
 *  keeps its own inline copy rather than calling this one (see the file
 *  header on same-file worklet-to-worklet calls). */
export function mulberry32(seed: number): () => number {
  "worklet";
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function overlayArt(kind: OverlayKind, seed: number): OverlayArt {
  "worklet";
  // Inlined PRNG (same algorithm as mulberry32 above) and clamp — nested
  // closures of this worklet, not calls to a sibling top-level one.
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

  switch (kind) {
    case "stars": {
      // Galaxy: a sprinkle of tiny star-flecks across the face.
      const dots: OverlayDot[] = [];
      for (let i = 0; i < 14; i++) {
        dots.push({ x: 0.08 + rng() * 0.84, y: 0.08 + rng() * 0.84, r: 0.01 + rng() * 0.022, a: 0.35 + rng() * 0.45 });
      }
      return { dots, strokes: [] };
    }
    case "grain": {
      // Walnut: soft wavy vertical grain lines.
      const strokes: OverlayStroke[] = [];
      const count = 4 + Math.floor(rng() * 2); // 4-5
      for (let i = 0; i < count; i++) {
        const baseX = 0.12 + (i / count) * 0.8 + rng() * 0.06;
        const pts: [number, number][] = [];
        const steps = 5;
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const wobble = (rng() - 0.5) * 0.05;
          pts.push([clamp01(baseX + wobble + Math.sin(t * Math.PI * 1.5 + i) * 0.03), t]);
        }
        strokes.push({ pts, w: 0.006 + rng() * 0.004, a: 0.18 + rng() * 0.12 });
      }
      return { dots: [], strokes };
    }
    case "veins": {
      // Marble: a few branching veins.
      const strokes: OverlayStroke[] = [];
      for (let i = 0; i < 3; i++) {
        let x = 0.15 + rng() * 0.7;
        let y = 0.1 + rng() * 0.15;
        const pts: [number, number][] = [[x, y]];
        const steps = 4 + Math.floor(rng() * 2);
        for (let s = 0; s < steps; s++) {
          x = clamp01(x + (rng() - 0.5) * 0.35);
          y = clamp01(y + 0.15 + rng() * 0.15);
          pts.push([x, y]);
        }
        strokes.push({ pts, w: 0.008 + rng() * 0.006, a: 0.22 + rng() * 0.15 });
      }
      return { dots: [], strokes };
    }
    case "facets": {
      // Diamond: a symmetric hex-cut gem pattern — a small inner hexagon (the
      // table facet) with a spoke out to each outer vertex (the crown
      // facets). Unlike the other overlay kinds this is intentionally NOT
      // randomized per-vertex: scattered chords at random angles/lengths read
      // as cracks, not cuts — a faceted gem only looks deliberate if the
      // lines line up. Only the whole pattern's rotation varies by seed (so
      // different skins using "facets" don't look identical), never its
      // symmetry.
      const sides = 6;
      const rIn = 0.15;
      const rOut = 0.42;
      const rot = -Math.PI / 2 + (seed % 12) * (Math.PI / 36);
      const inner: [number, number][] = [];
      const outer: [number, number][] = [];
      for (let i = 0; i < sides; i++) {
        const angle = rot + (i / sides) * Math.PI * 2;
        inner.push([0.5 + Math.cos(angle) * rIn, 0.5 + Math.sin(angle) * rIn]);
        outer.push([0.5 + Math.cos(angle) * rOut, 0.5 + Math.sin(angle) * rOut]);
      }
      const strokes: OverlayStroke[] = [];
      // The table outline.
      for (let i = 0; i < sides; i++) {
        strokes.push({ pts: [inner[i]!, inner[(i + 1) % sides]!], w: 0.007, a: 0.45 });
      }
      // One crown facet per vertex, out to the edge.
      for (let i = 0; i < sides; i++) {
        strokes.push({ pts: [inner[i]!, outer[i]!], w: 0.006, a: 0.35 });
      }
      return { dots: [], strokes };
    }
  }
}
