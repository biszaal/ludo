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

/**
 * What a skin inks onto its faces. Every value but "numeral" is a pip cluster
 * laid out on the usual die grid; "numeral" replaces the whole cluster with a
 * single figure, drawn from render/dieNumerals.ts (stroked centerlines, not
 * one of the filled glyphs below). Kept as a separate union from PipShape so
 * appendPip's signature still can't be handed something it cannot draw.
 */
export type FaceMark = PipShape | "numeral";
export type OverlayKind = "stars" | "veins" | "grain" | "facets" | "brushed" | "ice" | "twill";

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
  /**
   * Draw this stroke in white rather than in the skin's mark colour.
   *
   * Every overlay stroke used to be inked in the pip colour, which is right
   * for a vein in stone (a darker mineral in a paler one) and wrong for
   * anything whose texture is LIGHT catching a surface. Brushed metal is not
   * a set of dark scratches, it is alternating bright and shadowed hairlines,
   * and a fracture inside ice is brighter than the ice. With one colour
   * available, both came out as damage.
   */
  light?: boolean;
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
      // Mineral veining: two trunks crossing the whole face, each throwing a
      // couple of short hairline branches off it.
      //
      // This used to be three 5-point polylines that jumped up to 0.175 of the
      // face sideways per step — at die size that is a 9px lurch between
      // vertices, which draws a lightning bolt, not marble. A vein is a
      // BRANCHING system that wanders by a few degrees at a time, and it is the
      // branches that stop it reading as a crack; the board's own plate
      // texture has drawn it that way since render/boardArt.ts's `veins`, and
      // this is that shape at die scale. Turning by angle rather than by raw
      // offset is also what keeps the trunk continuous instead of jagged.
      const strokes: OverlayStroke[] = [];
      for (let i = 0; i < 2; i++) {
        let x = 0.16 + rng() * 0.68;
        let y = 0;
        let dir = (rng() - 0.5) * 0.9; // radians off straight down
        const pts: [number, number][] = [[clamp01(x), 0]];
        const step = 0.115;
        // The cap is a cost bound, not a shape choice: a trunk leaning at the
        // clamp advances ~0.05 per step, so 16 always reaches the far edge.
        while (y < 1 && pts.length < 16) {
          dir += (rng() - 0.5) * 0.5;
          dir = Math.max(-1.1, Math.min(1.1, dir));
          // Turn back at the edges rather than walking off the stone.
          if ((x < 0.08 && dir < 0) || (x > 0.92 && dir > 0)) dir = -dir;
          x += Math.sin(dir) * step;
          y += Math.cos(dir) * step;
          pts.push([clamp01(x), clamp01(y)]);
        }
        strokes.push({ pts, w: 0.007 + rng() * 0.006, a: 0.26 + rng() * 0.16 });

        const branches = 1 + Math.floor(rng() * 2);
        for (let b = 0; b < branches; b++) {
          const at = 1 + Math.floor(rng() * (pts.length - 2));
          const bx = pts[at]![0];
          const by = pts[at]![1];
          const away = (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.6);
          const len = 0.07 + rng() * 0.13;
          strokes.push({
            pts: [
              [clamp01(bx), clamp01(by)],
              [clamp01(bx + Math.sin(away) * len * 0.6), clamp01(by + Math.cos(away) * len * 0.5)],
              [clamp01(bx + Math.sin(away) * len), clamp01(by + Math.cos(away) * len * 0.9)],
            ],
            // Thinner and fainter than the trunk they leave — a branch that
            // matches its trunk reads as a second trunk, and two trunks
            // meeting at a point reads as a break.
            w: 0.0035 + rng() * 0.0035,
            a: 0.17 + rng() * 0.13,
          });
        }
      }
      return { dots: [], strokes };
    }
    case "facets": {
      // Diamond: a symmetric cut-gem pattern — a small inner polygon (the
      // table facet) with a spoke out to each outer vertex (the crown
      // facets). Unlike the other overlay kinds this is intentionally NOT
      // randomized per-vertex: scattered chords at random angles/lengths read
      // as cracks, not cuts — a faceted gem only looks deliberate if the
      // lines line up. What varies by seed is the pattern's rotation and the
      // NUMBER of sides, never the symmetry itself.
      //
      // Rotation alone was not enough separation. A hexagon is symmetric every
      // 60 degrees, so rotating it can only ever slide the same figure around;
      // every skin wearing this overlay was wearing the same cut, and on two
      // pale skins side by side that is one die in two colours. A brilliant
      // (8) and a step cut (6) are different objects at a glance.
      const sides = seed % 2 === 0 ? 6 : 8;
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
    case "brushed": {
      // Machined metal: dense, dead-straight hairlines running one way, about
      // half of them catching the light and half sitting in shadow.
      //
      // Metal skins used to borrow "grain", which is SAWN WOOD — four or five
      // fat lines with a sine wobble down them. On a titanium face that is
      // exactly what it looked like, which is the one material a machined die
      // must not read as. The difference between the two is not subtle and it
      // is not the colour: wood grain wanders and is sparse, a brushed finish
      // is straight, dense and fine. The only deviation here is a fraction of
      // a pixel at die size, which is just enough to stop it reading as a
      // printed screen.
      const strokes: OverlayStroke[] = [];
      const lines = 20;
      for (let i = 0; i < lines; i++) {
        // The jitter is a THIRD of the spacing, not a tenth. Evenly spaced
        // lines are a corduroy or a print screen; what makes a brushed finish
        // read as one is that the hairlines clump and leave gaps.
        const y = 0.04 + ((i + 0.5) / lines) * 0.92 + (rng() - 0.5) * 0.032;
        const drift = (rng() - 0.5) * 0.012;
        strokes.push({
          pts: [
            [0, clamp01(y)],
            [0.5, clamp01(y + drift)],
            [1, clamp01(y + drift * 0.35)],
          ],
          w: 0.005 + rng() * 0.005,
          a: 0.1 + rng() * 0.16,
          // Not alternating: a strict light/dark/light sequence is a corduroy,
          // not a finish. The runs of two or three the PRNG produces are what
          // makes it read as metal.
          light: rng() < 0.45,
        });
      }
      return { dots: [], strokes };
    }
    case "ice": {
      // Optic ice: internal fracture planes in a thick slab — long, nearly
      // straight chords running with the slab's depth, plus a scatter of
      // trapped air bubbles. Always light, because a fracture inside ice is
      // brighter than the ice around it, not darker.
      //
      // Deliberately NOT "facets". A cut gem is symmetric about a table
      // because someone cut it that way; ice is not cut at all, and sharing
      // the gem pattern is what made the two pale premium skins read as the
      // same die in two colours.
      const strokes: OverlayStroke[] = [];
      const dots: OverlayDot[] = [];
      const planes = 5;
      for (let i = 0; i < planes; i++) {
        // Steep: within about 30 degrees of vertical, so the planes run with
        // the slab rather than across it.
        const angle = -Math.PI / 2 + (rng() - 0.5) * 1.05;
        // Stratified across the width — one plane per band, jittered inside
        // it — rather than five free draws. Free draws leave whether the face
        // is evenly fractured up to the seed, and on a catalog this size that
        // is a coin flip per skin: this one's landed with all five chords
        // stacked down the right-hand third and the left half bare.
        const mx = 0.16 + ((i + rng()) / planes) * 0.68;
        const my = 0.18 + rng() * 0.64;
        const half = 0.28 + rng() * 0.3;
        const dx = Math.cos(angle) * half;
        const dy = Math.sin(angle) * half;
        // A hair of a kink at the midpoint, square to the chord. A perfectly
        // straight line is a scratch on the surface; a plane that steps once
        // is inside the material.
        const kink = (rng() - 0.5) * 0.09;
        // Square to the chord: (-dy, dx) normalised by the chord's own length.
        const px = (-dy / half) * kink;
        const py = (dx / half) * kink;
        strokes.push({
          pts: [
            [clamp01(mx - dx), clamp01(my - dy)],
            [clamp01(mx + px), clamp01(my + py)],
            [clamp01(mx + dx), clamp01(my + dy)],
          ],
          w: 0.005 + rng() * 0.006,
          a: 0.22 + rng() * 0.26,
          light: true,
        });
      }
      // Short secondary fractures. Five long chords alone read as five
      // scratches ON the face; the short ones at half the strength are what
      // turn them into planes INSIDE it, because a slab that has fractured
      // once has fractured at every scale.
      for (let i = 0; i < 6; i++) {
        const angle = -Math.PI / 2 + (rng() - 0.5) * 1.6;
        const sx = 0.14 + rng() * 0.72;
        const sy = 0.14 + rng() * 0.72;
        const len = 0.08 + rng() * 0.12;
        strokes.push({
          pts: [
            [clamp01(sx), clamp01(sy)],
            [clamp01(sx + Math.cos(angle) * len), clamp01(sy + Math.sin(angle) * len)],
          ],
          w: 0.004 + rng() * 0.004,
          a: 0.12 + rng() * 0.16,
          light: true,
        });
      }
      for (let i = 0; i < 7; i++) {
        dots.push({
          x: 0.12 + rng() * 0.76,
          y: 0.12 + rng() * 0.76,
          r: 0.007 + rng() * 0.013,
          a: 0.16 + rng() * 0.2,
        });
      }
      return { dots, strokes };
    }
    case "twill": {
      // 2x2 carbon weave. A real weave at die size is a couple of pixels
      // across and would cost hundreds of elements to draw as blocks; what the
      // eye reads at this scale is light running two ways over the surface, so
      // that is what is drawn — the same approximation, for the same reason,
      // as the matching board's plate texture (render/boardArt.ts's `twill`).
      //
      // The carbon DIE wore "grain" while the carbon BOARD wore twill, so one
      // half of a set sold together was woven and the other half was sawn wood.
      const strokes: OverlayStroke[] = [];
      // One diagonal at offset `t`, clipped to the unit square: d = 1 runs
      // top-left to bottom-right, d = -1 the other way. A nested closure, not
      // a sibling top-level function — see the file header.
      const diagonal = (t: number, d: number): [number, number][] | null => {
        const x0 = d > 0 ? Math.max(0, t) : Math.max(0, t - 1);
        const x1 = d > 0 ? Math.min(1, 1 + t) : Math.min(1, t);
        if (x1 - x0 < 0.1) return null; // a nick off a corner, not a tow
        const yAt = (xv: number) => (d > 0 ? xv - t : t - xv);
        return [
          [x0, clamp01(yAt(x0))],
          [x1, clamp01(yAt(x1))],
        ];
      };
      const tows = 7;
      for (let i = 0; i < tows; i++) {
        const u = i / (tows - 1);
        const down = diagonal(-0.85 + u * 1.7 + (rng() - 0.5) * 0.09, 1);
        if (down) strokes.push({ pts: down, w: 0.005 + rng() * 0.005, a: 0.1 + rng() * 0.15, light: rng() < 0.5 });
        const up = diagonal(0.15 + u * 1.7 + (rng() - 0.5) * 0.09, -1);
        if (up) strokes.push({ pts: up, w: 0.005 + rng() * 0.005, a: 0.1 + rng() * 0.15, light: rng() < 0.5 });
      }
      return { dots: [], strokes };
    }
  }
}
