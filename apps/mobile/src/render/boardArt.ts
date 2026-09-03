/**
 * Board art: the texture on the plate and the ornament around its edge.
 *
 * Why this exists. The first premium tier restyled boards by picking better
 * colors, and better colors is exactly what it looked like — twelve boards made
 * of the same flat rectangles. A player does not pay 100,000 coins for a nicer
 * shade of gold. What separates a board you want from a board you tolerate is
 * that its surface is made of SOMETHING (grain, veining, foliage, a sky) and
 * that its edge is WORKED (a Greek key, a rope, a run of pearls, a laurel).
 * Both of those are geometry, and geometry is free: this file emits plain data
 * — dots, polylines and glyph marks — that Board.tsx paints once per (size,
 * theme) into the static picture the board already caches. No image assets, no
 * bundle weight, sharp at every screen density, and re-themeable by changing
 * two fields.
 *
 * Everything here is seeded and deterministic (mulberry32, shared with
 * pipShapes.ts). A texture that reshuffles per render would shimmer on every
 * repaint; ornament that reshuffles at all stops reading as ornament — the
 * lesson faceMotifs.ts already records.
 *
 * Cost discipline. Counts scale with the board's area and are hard-capped, so a
 * 64px shop thumbnail draws a handful of marks and a 400px board draws a few
 * hundred — all inside the picture that is recorded once and reused for the
 * whole match (see Board.tsx's two-canvas split). Nothing here animates.
 */

import type { BoardGlyph } from "./boardGlyphs";
import type { MotifKind } from "./faceMotifs";
import { mulberry32 } from "./pipShapes";

export type TextureKind = "grain" | "veins" | "foliage" | "starfield" | "ripple" | "damask";
export type BandKind = "meander" | "rope" | "pearls" | "laurel" | "chevron" | "rays";
/** The composed figure printed on a yard plate — see yardEmblem. */
export type EmblemKind = "rose" | "wreath" | "medallion" | "constellation" | "lattice" | "rings";

/** A dot: soft speckle, a star, a pearl. */
export interface ArtDot {
  x: number;
  y: number;
  r: number;
  /** Alpha multiplier against the layer's own alpha, 0..1. */
  a: number;
}

/** An open polyline: a vein, a striation, a ripple, a key. */
export interface ArtStroke {
  pts: Array<[number, number]>;
  /** Stroke width in px. */
  w: number;
  a: number;
}

/** A glyph from boardGlyphs.ts, placed and rotated — leaves, blossoms, stones. */
export interface ArtMark {
  glyph: BoardGlyph;
  x: number;
  y: number;
  r: number;
  /** Radians, applied about (x, y). */
  rot: number;
  a: number;
}

/** An ornament figure from faceMotifs.ts — a rosette, engine turning, a deco
 *  sunburst — placed and sized. Shared with the dice tier on purpose: one
 *  ornament vocabulary across the whole catalog. */
export interface ArtMotif {
  kind: MotifKind;
  x: number;
  y: number;
  r: number;
  a: number;
}

export interface Art {
  dots: ArtDot[];
  strokes: ArtStroke[];
  marks: ArtMark[];
  motifs: ArtMotif[];
}

const EMPTY: Art = { dots: [], strokes: [], marks: [], motifs: [] };

/** FNV-1a — a stable seed per (theme, layer) so the same board textures the
 *  same way on every device and every launch. */
export function artSeed(...parts: string[]): number {
  let h = 2166136261;
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) {
      h ^= p.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}

/**
 * How many elements a texture gets at this board size.
 *
 * Referenced to a 340px board (a phone's play size) and clamped at both ends:
 * a shop thumbnail must not spend 300 draws on 64 pixels, and a tablet must not
 * grow the picture without bound. Density is per unit AREA, so a texture keeps
 * the same visual coarseness as the board scales instead of thinning out.
 */
function count(size: number, per340: number, density: number): number {
  const scaled = Math.round(per340 * density * (size / 340) ** 2);
  return Math.max(4, Math.min(Math.round(per340 * density * 1.6), scaled));
}

/**
 * How a texture is fitted to the surface it is printed on.
 *
 * A texture generated for a 340px plate and then re-run on a 118px yard plate
 * comes out wrong twice over: the element COUNT falls with area (six leaves,
 * not thirty) and every element's RADIUS falls with the canvas (a 1px leaf).
 * The result is a surface that looks blank and a developer who concludes the
 * layer does not work. These two dials say "same field, printed smaller":
 * `density` restores the count, `scale` restores the element size relative to
 * the surface. Both default to 1, which is the plate's own case.
 */
export interface TextureFit {
  density?: number;
  scale?: number;
}

/**
 * The plate's material, in board coordinates (0..size on both axes).
 *
 * Textures are drawn over the whole plate and are then largely covered by the
 * cells — what survives is the frame, the grout between cells and the ring
 * around each yard, which is precisely where a player reads "what is this board
 * made of". So these are tuned to read in thin slivers: long strokes that cross
 * the plate rather than detail that lands in one square inch of it.
 */
export function plateTexture(kind: TextureKind, seed: number, size: number, fit: TextureFit = {}): Art {
  const rnd = mulberry32(seed);
  const density = fit.density ?? 1;
  const z = fit.scale ?? 1;
  const dots: ArtDot[] = [];
  const strokes: ArtStroke[] = [];
  const marks: ArtMark[] = [];

  switch (kind) {
    case "grain": {
      // Brushed metal / sawn wood: near-parallel striations running the full
      // width, each with a slight wander so they are not a printed screen.
      const n = count(size, 46, density);
      for (let i = 0; i < n; i++) {
        const y = rnd() * size;
        const pts: Array<[number, number]> = [];
        const steps = 6;
        for (let s = 0; s <= steps; s++) {
          pts.push([(s / steps) * size, y + (rnd() - 0.5) * size * 0.012]);
        }
        strokes.push({ pts, w: (0.6 + rnd() * 1.1) * z, a: 0.25 + rnd() * 0.5 });
      }
      return { dots, strokes, marks, motifs: [] };
    }

    case "veins": {
      // Mineral veining: a few trunks crossing the plate diagonally, each
      // throwing short branches. Marble is a branching system, not scratches —
      // the branches are what stop this reading as damage.
      const trunks = count(size, 7, density);
      for (let i = 0; i < trunks; i++) {
        let x = rnd() * size;
        let y = -size * 0.05;
        let dir = (rnd() - 0.5) * 0.9;
        const pts: Array<[number, number]> = [[x, y]];
        const step = size / 11;
        while (y < size * 1.05) {
          dir += (rnd() - 0.5) * 0.5;
          dir = Math.max(-1.1, Math.min(1.1, dir));
          // Turn back at the edges. A vein is free to wander but not to walk
          // off the stone: an unbounded random walk spent a third of its length
          // outside the clip, which is geometry generated to be thrown away.
          if ((x < size * 0.06 && dir < 0) || (x > size * 0.94 && dir > 0)) dir = -dir;
          x += Math.sin(dir) * step;
          y += Math.cos(dir) * step;
          pts.push([x, y]);
        }
        strokes.push({ pts, w: (1 + rnd() * 1.6) * z, a: 0.5 + rnd() * 0.4 });
        // Branches: shorter, thinner, leaving the trunk at a shallow angle.
        const branches = 2 + Math.floor(rnd() * 3);
        for (let b = 0; b < branches; b++) {
          const at = 1 + Math.floor(rnd() * (pts.length - 2));
          const [bx, by] = pts[at]!;
          const away = (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.6);
          const len = size * (0.05 + rnd() * 0.12);
          strokes.push({
            pts: [
              [bx, by],
              [bx + Math.sin(away) * len * 0.6, by + Math.cos(away) * len * 0.5],
              [bx + Math.sin(away) * len, by + Math.cos(away) * len * 0.9],
            ],
            w: (0.6 + rnd() * 0.7) * z,
            a: 0.3 + rnd() * 0.3,
          });
        }
      }
      return { dots, strokes, marks, motifs: [] };
    }

    case "foliage": {
      // Leaves scattered as if the plate were seen through planting. Sizes vary
      // by a factor of three and rotation is free, which is the whole trick:
      // one leaf repeated at one angle reads as wallpaper.
      const n = count(size, 54, density);
      for (let i = 0; i < n; i++) {
        marks.push({
          glyph: "leaf",
          x: rnd() * size,
          y: rnd() * size,
          r: size * (0.008 + rnd() * 0.017) * z,
          rot: rnd() * Math.PI * 2,
          a: 0.35 + rnd() * 0.5,
        });
      }
      // A few blossoms among them, sparse enough to be a find rather than a
      // pattern.
      const blooms = count(size, 7, density);
      for (let i = 0; i < blooms; i++) {
        marks.push({
          glyph: "blossom",
          x: rnd() * size,
          y: rnd() * size,
          r: size * (0.007 + rnd() * 0.009) * z,
          rot: rnd() * Math.PI * 2,
          a: 0.4 + rnd() * 0.4,
        });
      }
      return { dots, strokes, marks, motifs: [] };
    }

    case "starfield": {
      // A sky: many faint pinpricks, a few bright ones, and two or three
      // four-pointed sparkles. The size distribution is squared so most stars
      // are small — an even spread reads as noise, not as a night sky.
      const n = count(size, 150, density);
      for (let i = 0; i < n; i++) {
        const t = rnd();
        dots.push({
          x: rnd() * size,
          y: rnd() * size,
          r: size * (0.0012 + t * t * 0.0055) * z,
          a: 0.25 + t * 0.7,
        });
      }
      const sparkles = count(size, 5, density);
      for (let i = 0; i < sparkles; i++) {
        marks.push({
          glyph: "sunburst",
          x: rnd() * size,
          y: rnd() * size,
          r: size * (0.012 + rnd() * 0.014) * z,
          rot: rnd() * Math.PI,
          a: 0.5 + rnd() * 0.4,
        });
      }
      return { dots, strokes, marks, motifs: [] };
    }

    case "ripple": {
      // Water: concentric rings around two or three drop points, each ring
      // slightly out of round and fading outward.
      const centers = 2 + Math.floor(rnd() * 2);
      for (let c = 0; c < centers; c++) {
        const cx = size * (0.15 + rnd() * 0.7);
        const cy = size * (0.15 + rnd() * 0.7);
        const rings = 4 + Math.floor(rnd() * 4);
        for (let k = 1; k <= rings; k++) {
          const rad = (size * 0.05 + k * size * 0.055) * (0.9 + rnd() * 0.2);
          const pts: Array<[number, number]> = [];
          const steps = 34;
          const wobble = 0.04 + rnd() * 0.05;
          for (let s = 0; s <= steps; s++) {
            const a = (s / steps) * Math.PI * 2;
            const rr = rad * (1 + Math.sin(a * 3 + c) * wobble);
            pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
          }
          strokes.push({ pts, w: (0.7 + rnd() * 0.8) * z, a: Math.max(0.12, 0.7 - k * 0.09) });
        }
      }
      return { dots, strokes, marks, motifs: [] };
    }

    case "damask": {
      // A textile diaper: one lozenge repeated on a staggered lattice, with a
      // dot in every gap. Strictly regular — this is the one texture that must
      // NOT wander, because a hand-printed silk is regular and a wobbling one
      // looks like a printing fault.
      const cols = Math.max(3, Math.round(7 / Math.sqrt(density)));
      const step = size / cols;
      for (let row = -1; row <= cols; row++) {
        for (let col = -1; col <= cols; col++) {
          const x = col * step + (row % 2 === 0 ? 0 : step / 2);
          const y = row * step;
          marks.push({ glyph: "lozenge", x, y, r: step * 0.26, rot: 0, a: 0.85 });
          // The trellis. Without it the lattice reads as scattered dots rather
          // than as woven cloth — the lines between the figures are what makes
          // a diaper pattern a pattern.
          strokes.push({
            pts: [
              [x, y + step * 0.3],
              [x + step * 0.5, y + step],
              [x + step, y + step * 0.3],
            ],
            w: Math.max(0.5, step * 0.03),
            a: 0.4,
          });
          dots.push({ x: x + step / 2, y: y + step / 2, r: step * 0.05, a: 0.55 });
        }
      }
      return { dots, strokes, marks, motifs: [] };
    }
  }
  return EMPTY;
}

/**
 * The worked edge: ornament running around the plate inside its rim.
 *
 * The frame is the widest unbroken stretch of plate on the board — nothing
 * covers it — so it is the one place ornament is guaranteed to be seen, and the
 * cheapest place to say "this board was made, not tinted".
 *
 * `inset` is the distance from the plate edge to the band's outer line and
 * `width` the band's thickness. The pattern is generated once along a straight
 * run and then mapped onto each of the four edges through a local (u, v) frame
 * — u along the edge, v across it, outer edge at v = 0 — so the corners meet
 * instead of colliding. The repeat is rounded to a whole number per edge and
 * the period adjusted to fit exactly, which is what a real border does: an
 * ornament that runs off mid-motif is the tell of a texture stretched to fit.
 */
export function frameBand(kind: BandKind, size: number, inset: number, width: number): Art {
  const dots: ArtDot[] = [];
  const strokes: ArtStroke[] = [];
  const marks: ArtMark[] = [];
  const length = size - inset * 2;
  if (length <= width * 2) return EMPTY;

  // Map local (u along the edge, v across it) to board coordinates, per edge.
  const place = (edge: number, u: number, v: number): [number, number] => {
    switch (edge) {
      case 0:
        return [inset + u, inset + v];
      case 1:
        return [size - inset - v, inset + u];
      case 2:
        return [size - inset - u, size - inset - v];
      default:
        return [inset + v, size - inset - u];
    }
  };
  // Rotation of a placed glyph on each edge, so leaves lie along the run.
  const spin = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

  /** Repeat count and exact period for a wanted period. */
  const fit = (want: number) => {
    const n = Math.max(2, Math.round(length / want));
    return { n, p: length / n };
  };

  for (let edge = 0; edge < 4; edge++) {
    switch (kind) {
      case "meander": {
        // Greek key. One unit is a spiral hook drawn in the band's own square,
        // and consecutive units share their vertical stroke, which is what
        // makes the run read as one continuous key rather than as stamps.
        //
        // Periods across this whole switch are deliberately long. The first cut
        // fitted a repeat every 0.6-1.5 band widths, which at a 7px band is
        // 40-80 motifs down each edge — past the point where an eye resolves
        // ornament, so it stopped reading as a border and started reading as
        // fuzz. Ornament has to be big enough to be recognised, or it is just
        // texture with extra steps.
        const { n, p } = fit(width * 2.8);
        for (let i = 0; i < n; i++) {
          const u0 = i * p;
          const m = width * 0.26; // stroke gauge
          const local: Array<[number, number]> = [
            [u0, width],
            [u0, m],
            [u0 + p - m, m],
            [u0 + p - m, width - m],
            [u0 + m * 2, width - m],
            [u0 + m * 2, m * 2.2],
          ];
          strokes.push({ pts: local.map(([u, v]) => place(edge, u, v)), w: Math.max(0.7, m * 0.62), a: 1 });
        }
        break;
      }

      case "rope": {
        // Twisted cord: two sine runs a half period out of phase. Where they
        // cross reads as the twist.
        const { n, p } = fit(width * 2.4);
        for (const phase of [0, Math.PI]) {
          const pts: Array<[number, number]> = [];
          const steps = n * 8;
          for (let s = 0; s <= steps; s++) {
            const u = (s / steps) * length;
            const v = width / 2 + Math.sin((u / p) * Math.PI * 2 + phase) * width * 0.3;
            pts.push(place(edge, u, v));
          }
          strokes.push({ pts, w: Math.max(0.8, width * 0.16), a: 1 });
        }
        break;
      }

      case "pearls": {
        // A run of beads, alternating large and small. Beading is the oldest
        // trick in framing and it survives being 2px wide, which most ornament
        // does not.
        const { n, p } = fit(width * 1.5);
        for (let i = 0; i < n; i++) {
          const [x, y] = place(edge, i * p + p / 2, width / 2);
          dots.push({ x, y, r: (i % 2 === 0 ? 0.3 : 0.16) * width, a: 1 });
        }
        break;
      }

      case "laurel": {
        // Leaf pairs along a stem — a wreath unrolled. The pairs alternate
        // which side leads so the run has direction, like a real laurel.
        const { n, p } = fit(width * 2.8);
        strokes.push({
          pts: [place(edge, 0, width / 2), place(edge, length, width / 2)],
          w: Math.max(0.6, width * 0.09),
          a: 0.8,
        });
        for (let i = 0; i < n; i++) {
          const u = i * p + p / 2;
          const lead = i % 2 === 0 ? 1 : -1;
          for (const side of [-1, 1]) {
            const [x, y] = place(edge, u + side * p * 0.12, width / 2 + side * width * 0.24);
            marks.push({
              glyph: "leaf",
              x,
              y,
              r: width * 0.42,
              rot: spin[edge]! + side * lead * 0.6,
              a: 1,
            });
          }
        }
        break;
      }

      case "rays": {
        // Ticks of two lengths on a baseline — an astronomer's rule. The long
        // ticks land on every fourth beat, which is what gives the run a pulse
        // instead of a hum.
        const { n, p } = fit(width * 1.4);
        strokes.push({
          pts: [place(edge, 0, width * 0.92), place(edge, length, width * 0.92)],
          w: Math.max(0.5, width * 0.07),
          a: 0.7,
        });
        for (let i = 0; i < n; i++) {
          const u = i * p + p / 2;
          const long = i % 4 === 0;
          strokes.push({
            pts: [place(edge, u, width * 0.92), place(edge, u, long ? width * 0.1 : width * 0.5)],
            w: Math.max(0.5, width * (long ? 0.13 : 0.09)),
            a: long ? 1 : 0.6,
          });
        }
        break;
      }

      case "chevron": {
        // Deco zigzag, one continuous polyline per edge.
        const { n, p } = fit(width * 2.2);
        const pts: Array<[number, number]> = [];
        for (let i = 0; i <= n; i++) {
          pts.push(place(edge, i * p, i % 2 === 0 ? width * 0.16 : width * 0.84));
        }
        strokes.push({ pts, w: Math.max(0.7, width * 0.15), a: 1 });
        break;
      }
    }
  }

  return { dots, strokes, marks, motifs: [] };
}

/**
 * A yard plate's emblem: ONE composed, symmetric figure, centred.
 *
 * This replaced a scattered texture, and the difference is the whole line
 * between decoration and mess. Thirty leaves dropped at random angles is what a
 * texture generator produces; it is not what a garden looks like. A garden
 * worth putting on a board is a parterre — a bloom at the centre, sprigs at the
 * corners, a bed ring around them, every element placed. The same holds for
 * goldwork, for a star chart, for brocade: symmetry is what the eye reads as
 * "designed", and randomness at this scale reads as dirt on the surface.
 *
 * So nothing here is seeded, because nothing here is random. Each emblem is a
 * fixed figure in local coordinates (0..size), sized to sit inside the yard
 * plate and to pass behind the four pawn slots like a rug under furniture.
 */
export function yardEmblem(kind: EmblemKind, size: number): Art {
  const dots: ArtDot[] = [];
  const strokes: ArtStroke[] = [];
  const marks: ArtMark[] = [];
  const motifs: ArtMotif[] = [];
  const c = size / 2;
  const R = size * 0.42;
  const ring = (radius: number, w: number, a: number) => {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 64; i++) {
      const t = (i / 64) * Math.PI * 2;
      pts.push([c + Math.cos(t) * radius, c + Math.sin(t) * radius]);
    }
    strokes.push({ pts, w, a });
  };

  switch (kind) {
    case "rose": {
      // A parterre: a bloom at the centre, eight leaves opening from it, a
      // hair-fine bed ring, and a sprig in each corner.
      marks.push({ glyph: "blossom", x: c, y: c, r: R * 0.34, rot: 0, a: 1 });
      for (let i = 0; i < 8; i++) {
        const t = (i / 8) * Math.PI * 2;
        marks.push({
          glyph: "leaf",
          x: c + Math.cos(t) * R * 0.62,
          y: c + Math.sin(t) * R * 0.62,
          r: R * 0.24,
          rot: t + Math.PI / 2,
          a: 0.85,
        });
      }
      ring(R * 0.94, Math.max(0.6, size * 0.006), 0.45);
      // No corner sprigs. They were there, and they sat exactly where the four
      // pawn slots sit — ornament crowding the pieces, which is the difference
      // between a bed and a weed.
      break;
    }

    case "wreath": {
      // Twelve leaves laid tangentially in a circle, tips following the run —
      // a wreath, not a scatter. A single bloom closes it at the top.
      const n = 12;
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2 - Math.PI / 2;
        marks.push({ glyph: "leaf", x: c + Math.cos(t) * R * 0.8, y: c + Math.sin(t) * R * 0.8, r: R * 0.22, rot: t, a: 0.8 });
      }
      marks.push({ glyph: "blossom", x: c, y: c - R * 0.8, r: R * 0.2, rot: 0, a: 1 });
      ring(R * 0.52, Math.max(0.5, size * 0.005), 0.3);
      break;
    }

    case "medallion": {
      // Engine turning between two rings: the goldsmith's answer, and the one
      // that survives being looked at every turn for a whole match.
      motifs.push({ kind: "guilloche", x: c, y: c, r: R * 0.72, a: 0.9 });
      ring(R * 0.94, Math.max(0.7, size * 0.008), 0.7);
      ring(R * 0.86, Math.max(0.5, size * 0.004), 0.4);
      dots.push({ x: c, y: c, r: size * 0.018, a: 0.8 });
      break;
    }

    case "constellation": {
      // Seven stars and the lines between them. A chart is DRAWN, which is why
      // it reads as a chart where a random scatter reads as dust.
      const stars: Array<[number, number, number]> = [
        [0.1, 0.66, 1],
        [0.29, 0.74, 0.7],
        [0.47, 0.63, 0.85],
        [0.61, 0.47, 0.6],
        [0.75, 0.35, 0.9],
        [0.88, 0.24, 0.7],
        [0.71, 0.12, 1],
      ];
      const px = (u: number) => size * (0.1 + u * 0.8);
      const py = (v: number) => size * (0.1 + v * 0.8);
      strokes.push({ pts: stars.map(([u, v]) => [px(u), py(v)] as [number, number]), w: Math.max(0.5, size * 0.005), a: 0.4 });
      for (const [u, v, mag] of stars) {
        dots.push({ x: px(u), y: py(v), r: size * (0.008 + mag * 0.013), a: 0.5 + mag * 0.5 });
      }
      marks.push({ glyph: "sunburst", x: px(stars[6]![0]), y: py(stars[6]![1]), r: size * 0.05, rot: 0, a: 0.9 });
      break;
    }

    case "lattice": {
      // Brocade: a diagonal trellis on an exact grid with a small stone at each
      // crossing. Regular by construction — a wobbling diaper is a printing
      // fault, not a texture.
      const step = size / 4;
      // Only the diagonals that actually cross the plate. Each direction has
      // its own range — a line leaning right enters from the left and one
      // leaning left enters from the right — and generating the union of both
      // ranges for both directions draws a third of the trellis off the cloth.
      for (const dir of [1, -1] as const) {
        const from = dir === 1 ? -4 : 0;
        const to = dir === 1 ? 4 : 8;
        for (let i = from; i <= to; i++) {
          strokes.push({
            pts: [
              [i * step, 0],
              [i * step + dir * size, size],
            ],
            w: Math.max(0.5, size * 0.004),
            a: 0.28,
          });
        }
      }
      for (let row = 0; row <= 4; row++) {
        for (let col = 0; col <= 4; col++) {
          if ((row + col) % 2) continue;
          marks.push({ glyph: "lozenge", x: col * step, y: row * step, r: step * 0.17, rot: 0, a: 0.7 });
        }
      }
      break;
    }

    case "rings": {
      // Still water: four concentric rings, evenly spaced, and nothing else.
      for (let i = 1; i <= 4; i++) ring(R * 0.28 * i, Math.max(0.5, size * 0.006), 0.85 - i * 0.13);
      dots.push({ x: c, y: c, r: size * 0.014, a: 0.7 });
      break;
    }
  }

  return { dots, strokes, marks, motifs };
}
