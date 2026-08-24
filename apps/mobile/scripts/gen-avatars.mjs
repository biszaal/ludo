/**
 * Generates the avatar chips — the fourteen Ludo Club–style characters, drawn
 * in code here and shipped as PNGs (same pure-Node approach and hand-rolled PNG
 * encoder as gen-app-icon.mjs / gen-emoji.mjs).
 *
 * This script is the source of truth for what the avatars LOOK like. The app
 * only knows their ids and the image files; src/render/avatars.ts holds the id
 * list and the require() map. If you change art here, re-run and commit the
 * PNGs — nothing regenerates them at build time.
 *
 * Rendering notes:
 *  - Geometry lives in the same 100x100 design space the Skia version used, so
 *    the path data is unchanged from when these were drawn at runtime.
 *  - Fills use scanline + nonzero winding; strokes use distance-to-polyline,
 *    which yields round caps. The only stroke whose caps are not already closed
 *    or hidden is the headphone band, whose ends sit under the earcups.
 *  - 3x supersampled, then box-downsampled, matching the sibling generators.
 *
 * Run: node scripts/gen-avatars.mjs
 * Outputs: assets/images/avatars/<id>.png (512px, transparent outside the chip)
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const OUT_SIZE = 512;
const SS = 3; // supersample factor, as in gen-app-icon.mjs
const DESIGN = 100; // the coordinate space all the path data is written in

// --- Catalog ----------------------------------------------------------------

/**
 * The chip tones. The seats own red, green, yellow and blue, so the chips use
 * none of those families: a tone is either a true grey (r === g === b, no hue
 * at all) or sits in the violet/magenta band, which is the widest gap the seat
 * hues leave — 132deg between blue at 226 and red at 358. Every violet here is
 * at least 40deg from all four.
 *
 * Hue is only half of it, and the weaker half — it collapses under
 * colorblindness. Every tone is also far paler and flatter than any seat
 * (sat <= 0.30 vs 0.56-0.86, light >= 0.74 vs 0.42-0.59), so the frame reads
 * as the color and the chip reads as tinted paper. See the tests in
 * __tests__/avatars.test.ts, which enforce all of it.
 */
export const CHIP_TONES = {
  pearl: { top: "#F0F0F0", bottom: "#C9C9C9" },
  slate: { top: "#DEDEDE", bottom: "#B5B5B5" },
  lilac: { top: "#EBE1EF", bottom: "#C8AAD5" },
  violet: { top: "#EFE1EF", bottom: "#D5AAD5" },
  orchid: { top: "#EEE1EC", bottom: "#D3AACB" },
};

export const AVATARS = [
  { id: "leo", skin: "#FFD9B3", hair: "#7A4A21", shirt: "#B98A3E", style: "crown", tone: "pearl", pattern: "halo" },
  { id: "sunny", skin: "#FFE0C2", hair: "#E8542F", shirt: "#C07551", style: "spiky", tone: "pearl", pattern: "rays" },
  { id: "coco", skin: "#8A5A3B", hair: "#26150B", shirt: "#4E8A6B", style: "afro", tone: "violet", pattern: "dots" },
  { id: "zara", skin: "#C68642", hair: "#2B1B10", shirt: "#B06A82", style: "bun", tone: "orchid", pattern: "arcs" },
  { id: "rex", skin: "#FFD9B3", hair: "#5A3A1E", shirt: "#5F76B0", style: "cap", tone: "slate", pattern: "bands" },
  { id: "nina", skin: "#8A5A3B", hair: "#1E1208", shirt: "#8168AD", style: "pigtails", tone: "lilac", pattern: "split" },
  { id: "milo", skin: "#FFE0C2", hair: "#B0722F", shirt: "#4C8C87", style: "side", tone: "violet", pattern: "checks" },
  { id: "ivy", skin: "#F3C7A5", hair: "#C2572E", shirt: "#6E8C55", style: "beanie", tone: "pearl", pattern: "dots" },
  { id: "ace", skin: "#E8B98A", hair: "#6E3FBF", shirt: "#6870AD", style: "headphones", tone: "lilac", pattern: "bands" },
  { id: "ruby", skin: "#FFD9B3", hair: "#4A2C15", shirt: "#A85A5A", style: "bow", tone: "orchid", pattern: "rays" },
  { id: "bruno", skin: "#E8B98A", hair: "#3D2A1A", shirt: "#B08A55", style: "beard", tone: "pearl", pattern: "checks" },
  { id: "kito", skin: "#F5B78D", hair: "#E88A3C", shirt: "#6B8395", style: "cat", tone: "pearl", pattern: "split" },
  // The gem tier (0018 seed) — same drawn styles, premium shirt tones.
  { id: "nova", skin: "#F3C7A5", hair: "#8E86AD", shirt: "#7A6BB5", style: "spiky", tone: "lilac", pattern: "halo" },
  { id: "onyx", skin: "#C68642", hair: "#0B0C0F", shirt: "#2A2E36", style: "cap", tone: "slate", pattern: "checks" },
];;

const NEUTRAL_BROW = "#5A4632";

/** Full draw list for one avatar: torso, head, hair/hat, face. */
function buildOps(spec) {
  const { skin, hair, style, shirt } = spec;
  const ops = [
    { t: "oval", cx: 50, cy: 102, rx: 30, ry: 20, fill: shirt }, // torso
    { t: "circle", cx: 50, cy: 55, r: 26, fill: skin },
    { t: "ring", cx: 50, cy: 55, r: 26, color: "rgba(0,0,0,0.12)", w: 1.5 },
    { t: "circle", cx: 24, cy: 56, r: 5, fill: skin },
    { t: "ring", cx: 24, cy: 56, r: 5, color: "rgba(0,0,0,0.12)", w: 1.2 },
    { t: "circle", cx: 76, cy: 56, r: 5, fill: skin },
    { t: "ring", cx: 76, cy: 56, r: 5, color: "rgba(0,0,0,0.12)", w: 1.2 },
  ];

  switch (style) {
    case "crown":
      ops.push(
        { t: "path", d: "M50 24 A26 26 0 0 1 76 52 L24 52 A26 26 0 0 1 50 24 Z", fill: hair },
        { t: "path", d: "M34 22 L37 8 L45 17 L50 4 L55 17 L63 8 L66 22 Z", fill: "#FFE45C" },
        { t: "stroke", d: "M34 22 L37 8 L45 17 L50 4 L55 17 L63 8 L66 22 Z", color: "#B8770A", w: 2.5 },
        { t: "path", d: "M33.5 20 H66.5 A3.5 3.5 0 0 1 66.5 27 H33.5 A3.5 3.5 0 0 1 33.5 20 Z", fill: "#FFE45C" },
        { t: "stroke", d: "M33.5 20 H66.5 A3.5 3.5 0 0 1 66.5 27 H33.5 A3.5 3.5 0 0 1 33.5 20 Z", color: "#B8770A", w: 2.5 },
      );
      break;
    case "spiky":
      ops.push({
        t: "path",
        d: "M26 48 C24 30 34 24 38 30 L40 22 L45 29 L50 19 L55 29 L60 22 L62 30 C68 24 76 30 74 48 C66 38 34 38 26 48 Z",
        fill: hair,
      });
      break;
    case "afro":
      ops.push(
        { t: "circle", cx: 50, cy: 31, r: 19, fill: hair },
        { t: "circle", cx: 33, cy: 38, r: 10, fill: hair },
        { t: "circle", cx: 67, cy: 38, r: 10, fill: hair },
        { t: "path", d: "M26 47 A26 26 0 0 1 74 47 L74 42 A26 26 0 0 0 26 42 Z", fill: hair },
      );
      break;
    case "bun":
      ops.push(
        { t: "circle", cx: 50, cy: 22, r: 10, fill: hair },
        { t: "path", d: "M24 56 C22 34 36 27 50 27 C64 27 78 34 76 56 C74 44 66 40 50 40 C34 40 26 44 24 56 Z", fill: hair },
        { t: "ring", cx: 24, cy: 63, r: 4, color: "#F5C542", w: 2.4 },
        { t: "ring", cx: 76, cy: 63, r: 4, color: "#F5C542", w: 2.4 },
      );
      break;
    case "cap":
      ops.push(
        { t: "path", d: "M26 46 A25 25 0 0 1 74 46 L74 42 L26 42 Z", fill: hair },
        { t: "path", d: "M25 44 A25 22 0 0 1 75 44 L75 47 L25 47 Z", fill: shirt },
        { t: "path", d: "M23 43 H77 A3.5 3.5 0 0 1 77 50 H23 A3.5 3.5 0 0 1 23 43 Z", fill: shade(shirt, -0.25) },
        { t: "circle", cx: 50, cy: 27, r: 4, fill: shade(shirt, -0.25) },
      );
      break;
    case "pigtails":
      ops.push(
        { t: "circle", cx: 22, cy: 40, r: 9, fill: hair },
        { t: "circle", cx: 78, cy: 40, r: 9, fill: hair },
        { t: "path", d: "M24 54 C24 32 38 26 50 26 C62 26 76 32 76 54 C70 42 62 38 50 38 C38 38 30 42 24 54 Z", fill: hair },
      );
      break;
    case "side":
      ops.push({
        t: "path",
        d: "M24 52 C24 30 40 24 54 27 C68 30 76 38 75 52 C70 40 62 40 58 34 C50 42 32 40 24 52 Z",
        fill: hair,
      });
      for (const fx of [40, 46, 54, 60]) ops.push({ t: "circle", cx: fx, cy: 63, r: 1.3, fill: "rgba(160,90,40,0.55)" });
      break;
    case "beanie":
      ops.push(
        { t: "circle", cx: 50, cy: 21, r: 6.5, fill: "#5E9E3A" },
        { t: "path", d: "M23 45 A27 25 0 0 1 77 45 Z", fill: "#4C7F2C" },
        { t: "path", d: "M22 41 H78 A4.2 4.2 0 0 1 78 49.5 H22 A4.2 4.2 0 0 1 22 41 Z", fill: "#3E6A23" },
      );
      break;
    case "headphones":
      ops.push(
        { t: "path", d: "M26 50 C26 30 42 25 50 25 C58 25 74 30 74 50 C66 36 34 36 26 50 Z", fill: hair },
        { t: "stroke", d: "M24 52 A26 26 0 0 1 76 52", color: "#2A2E39", w: 5 },
        { t: "path", d: "M19 48 H29 A5 5 0 0 1 29 62 H19 A5 5 0 0 1 19 48 Z", fill: "#2A2E39" },
        { t: "path", d: "M71 48 H81 A5 5 0 0 1 81 62 H71 A5 5 0 0 1 71 48 Z", fill: "#2A2E39" },
        { t: "path", d: "M21.5 51 H26.5 A2.5 2.5 0 0 1 26.5 59 H21.5 A2.5 2.5 0 0 1 21.5 51 Z", fill: "#4E56C9" },
        { t: "path", d: "M73.5 51 H78.5 A2.5 2.5 0 0 1 78.5 59 H73.5 A2.5 2.5 0 0 1 73.5 51 Z", fill: "#4E56C9" },
      );
      break;
    case "bow":
      ops.push(
        {
          t: "path",
          d: "M24 54 C24 32 36 26 50 26 C64 26 76 32 76 54 C72 44 64 41 58 42 C60 38 58 34 54 33 C50 40 32 42 24 54 Z",
          fill: hair,
        },
        // Bow at (66,30), rotated ~18°: two triangles + knot (pre-transformed points).
        { t: "path", d: "M66 30 L57.4 22.9 L53.7 34.3 Z", fill: "#E8386D" },
        { t: "path", d: "M66 30 L78.3 25.7 L74.6 37.1 Z", fill: "#E8386D" },
        { t: "circle", cx: 66, cy: 30, r: 3.4, fill: "#C21850" },
      );
      break;
    case "beard":
      ops.push(
        { t: "path", d: "M27 50 A25 25 0 0 1 73 50 L73 44 A25 25 0 0 0 27 44 Z", fill: hair },
        { t: "path", d: "M31 60 C31 76 40 81 50 81 C60 81 69 76 69 60 C66 70 58 72 50 72 C42 72 34 70 31 60 Z", fill: hair },
      );
      break;
    case "cat":
      ops.push(
        { t: "path", d: "M28 40 L22 20 L40 30 Z", fill: hair },
        { t: "path", d: "M72 40 L78 20 L60 30 Z", fill: hair },
        { t: "path", d: "M31 38 L27 25 L38 31 Z", fill: "#FFC9A3" },
        { t: "path", d: "M69 38 L73 25 L62 31 Z", fill: "#FFC9A3" },
        { t: "path", d: "M26 50 A26 24 0 0 1 74 50 L74 44 A26 26 0 0 0 26 44 Z", fill: hair },
      );
      break;
  }

  // Mouth (cat gets a muzzle + whiskers instead of the open smile).
  if (style === "cat") {
    ops.push(
      { t: "oval", cx: 50, cy: 66, rx: 10, ry: 7, fill: "#FFE8D6" },
      { t: "path", d: "M47 62 L53 62 L50 66 Z", fill: "#E8698A" },
      {
        t: "stroke",
        d: "M50 66 L50 69 M50 69 C48 71 46 71 45 70 M50 69 C52 71 54 71 55 70",
        color: "rgba(0,0,0,0.5)",
        w: 1.4,
        round: true,
      },
      { t: "stroke", d: "M36 62 L26 61 M36 66 L26 65 M64 62 L74 61 M64 66 L74 65", color: "rgba(0,0,0,0.35)", w: 1.3, round: true },
    );
  } else {
    ops.push({ t: "path", d: "M42 66 Q50 75 58 66 Q50 70 42 66 Z", fill: "#7A3B2E" });
  }

  // Eyes + shine.
  const eyeCy = style === "cat" ? 54 : 55;
  const eyeRy = style === "cat" ? 6.2 : 5.6;
  for (const ex of [41, 59]) {
    ops.push(
      { t: "oval", cx: ex, cy: eyeCy, rx: 4.6, ry: eyeRy, fill: "#26221E" },
      { t: "circle", cx: ex + 1.6, cy: eyeCy - 2.5, r: 1.7, fill: "#FFFFFF" },
    );
  }

  // Brows (cats skip them; hat styles use the neutral brow tone).
  if (style !== "cat") {
    const brow = style === "cap" || style === "beanie" || style === "headphones" ? NEUTRAL_BROW : hair;
    ops.push(
      { t: "stroke", d: "M36 47 Q41 44 46 47", color: brow, w: 2.2, round: true },
      { t: "stroke", d: "M54 47 Q59 44 64 47", color: brow, w: 2.2, round: true },
    );
  }

  // Blush.
  ops.push(
    { t: "oval", cx: 33, cy: 62, rx: 4.5, ry: 2.8, fill: "rgba(255,120,120,0.35)" },
    { t: "oval", cx: 67, cy: 62, rx: 4.5, ry: 2.8, fill: "rgba(255,120,120,0.35)" },
  );
  return ops;
}

export const PATTERNS = ["checks", "halo", "rays", "dots", "arcs", "bands", "split"];

const INK = "rgba(0,0,0,0.085)";
const LIFT = "rgba(255,255,255,0.55)";

/**
 * The chip's pattern, drawn between the gradient and the character. Coarse on
 * purpose — the chip renders at 48pt on a player card, where fine texture just
 * turns to mud. Every shape is black or white alpha, so a pattern can only
 * darken or lighten the tone, never tint it toward a seat color.
 */
export function chipOps(spec) {
  switch (spec.pattern) {
    case "checks":
      // Two opposing quadrants — the coarsest pattern here, and the one that
      // survives furthest down the size range.
      return [
        { t: "path", d: "M0 0 L50 0 L50 50 L0 50 Z", fill: INK },
        { t: "path", d: "M50 50 L100 50 L100 100 L50 100 Z", fill: INK },
      ];
    case "halo":
      return [{ t: "ring", cx: 50, cy: 50, r: 41, color: INK, w: 13 }];
    case "rays": {
      // Six wedges of twelve, alternating. Radius overshoots the chip so the
      // straight chords still cover past the rim before it is clipped.
      const ops = [];
      for (let i = 0; i < 12; i += 2) {
        const a0 = (i / 12) * Math.PI * 2, a1 = ((i + 1) / 12) * Math.PI * 2;
        const pt = (a) => `${(50 + 80 * Math.cos(a)).toFixed(2)} ${(50 + 80 * Math.sin(a)).toFixed(2)}`;
        ops.push({ t: "path", d: `M50 50 L${pt(a0)} L${pt(a1)} Z`, fill: INK });
      }
      return ops;
    }
    case "dots":
      return [[20, 20], [50, 11], [80, 20], [11, 50], [89, 50], [23, 79], [77, 79]]
        .map(([cx, cy]) => ({ t: "circle", cx, cy, r: 9, fill: INK }));
    case "arcs":
      return [22, 34, 46].map((r) => ({ t: "ring", cx: 50, cy: 50, r, color: INK, w: 6 }));
    case "bands": {
      const ops = [];
      for (let x = -60; x < 110; x += 34) {
        ops.push({ t: "path", d: `M${x} -10 L${x + 17} -10 L${x + 137} 110 L${x + 120} 110 Z`, fill: INK });
      }
      return ops;
    }
    case "split":
      return [{ t: "path", d: "M0 0 L100 0 L0 100 Z", fill: LIFT }];
    default:
      throw new Error(`unknown chip pattern: ${spec.pattern}`);
  }
}

/**
 * Mirrors `shade` in src/theme.ts — kept local so this script stays runnable
 * with no imports from the app. If the app's version changes, change this too.
 */
function shade(hex, amt) {
  const n = parseInt(hex.replace("#", ""), 16);
  const target = amt >= 0 ? 255 : 0;
  const p = Math.abs(amt);
  const mix = (c) => Math.round((target - c) * p + c);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

// --- Color ------------------------------------------------------------------

/** Accepts "#rgb", "#rrggbb", "rgb(r, g, b)" and "rgba(r, g, b, a)". */
export function parseColor(c) {
  let m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return [...m[1].split("").map((h) => parseInt(h + h, 16)), 1];
  m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (m) {
    const p = m[1].split(",").map((v) => parseFloat(v.trim()));
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  throw new Error(`unparseable color: ${c}`);
}

/** Hue (deg), saturation and lightness (0-1) of a #rrggbb color. */
export function hslOf(hex) {
  const [r255, g255, b255] = parseColor(hex);
  const [r, g, b] = [r255 / 255, g255 / 255, b255 / 255];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  if (d) {
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: d ? d / (l > 0.5 ? 2 - max - min : max + min) : 0, l };
}

/** HSL saturation, 0-1; NaN for non-hex input. Guards shirts against seat colors. */
export function saturationOf(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return NaN;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  return (max - min) / (l > 0.5 ? 2 - max - min : max + min);
}

/** WCAG contrast ratio, 1-21. Guards hair against vanishing into the chip. */
export function contrastRatio(a, b) {
  const lum = (hex) => {
    const [r, g, b2] = parseColor(hex);
    const ch = [r, g, b2].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// --- SVG path -> flattened polylines ----------------------------------------
// Only the commands the avatar art actually uses, all absolute: M A C H L Q Z.

const CUBIC_STEPS = 24;
const QUAD_STEPS = 16;

/** Elliptical arc, endpoint parameterisation (SVG F.6.1) -> points. */
function arcPoints(x0, y0, rx, ry, rot, largeArc, sweep, x, y) {
  if (x0 === x && y0 === y) return [];
  const rad = (rot * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx2 = (x0 - x) / 2, dy2 = (y0 - y) / 2;
  const x1 = cos * dx2 + sin * dy2;
  const y1 = -sin * dx2 + cos * dy2;
  rx = Math.abs(rx); ry = Math.abs(ry);
  // Scale up radii that are too small to span the endpoints (SVG F.6.6).
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
  const sign = largeArc === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cx1 = (co * rx * y1) / ry;
  const cy1 = (-co * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (x0 + x) / 2;
  const cy = sin * cx1 + cos * cy1 + (y0 + y) / 2;
  const ang = (ux, uy, vx, vy) => {
    const d = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let t = Math.acos(Math.min(1, Math.max(-1, (ux * vx + uy * vy) / d)));
    if (ux * vy - uy * vx < 0) t = -t;
    return t;
  };
  const theta = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const steps = Math.max(8, Math.ceil((Math.abs(delta) / (Math.PI / 2)) * 16));
  const pts = [];
  for (let i = 1; i <= steps; i++) {
    const t = theta + (delta * i) / steps;
    const px = cos * rx * Math.cos(t) - sin * ry * Math.sin(t) + cx;
    const py = sin * rx * Math.cos(t) + cos * ry * Math.sin(t) + cy;
    pts.push([px, py]);
  }
  return pts;
}

/** Parses a path `d` into subpaths of flattened points. */
export function parsePath(d) {
  const subpaths = [];
  let cur = null, cx = 0, cy = 0, sx = 0, sy = 0;
  const nums = (s) => (s.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
  for (const m of d.matchAll(/([MACHLQZ])([^MACHLQZ]*)/gi)) {
    const cmd = m[1].toUpperCase();
    const a = nums(m[2]);
    if (cmd === "M") {
      if (cur && cur.length > 1) subpaths.push(cur);
      cx = a[0]; cy = a[1]; sx = cx; sy = cy;
      cur = [[cx, cy]];
      // Extra coordinate pairs after an M are implicit L commands.
      for (let i = 2; i + 1 < a.length; i += 2) { cx = a[i]; cy = a[i + 1]; cur.push([cx, cy]); }
    } else if (cmd === "L") {
      for (let i = 0; i + 1 < a.length; i += 2) { cx = a[i]; cy = a[i + 1]; cur.push([cx, cy]); }
    } else if (cmd === "H") {
      for (const v of a) { cx = v; cur.push([cx, cy]); }
    } else if (cmd === "C") {
      for (let i = 0; i + 5 < a.length; i += 6) {
        const [x1, y1, x2, y2, x, y] = a.slice(i, i + 6);
        for (let s = 1; s <= CUBIC_STEPS; s++) {
          const t = s / CUBIC_STEPS, u = 1 - t;
          cur.push([
            u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
            u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
          ]);
        }
        cx = x; cy = y;
      }
    } else if (cmd === "Q") {
      for (let i = 0; i + 3 < a.length; i += 4) {
        const [x1, y1, x, y] = a.slice(i, i + 4);
        for (let s = 1; s <= QUAD_STEPS; s++) {
          const t = s / QUAD_STEPS, u = 1 - t;
          cur.push([u * u * cx + 2 * u * t * x1 + t * t * x, u * u * cy + 2 * u * t * y1 + t * t * y]);
        }
        cx = x; cy = y;
      }
    } else if (cmd === "A") {
      for (let i = 0; i + 6 < a.length; i += 7) {
        const [rx, ry, rot, laf, sf, x, y] = a.slice(i, i + 7);
        cur.push(...arcPoints(cx, cy, rx, ry, rot, laf, sf, x, y));
        cx = x; cy = y;
      }
    } else if (cmd === "Z") {
      if (cur) { cur.push([sx, sy]); subpaths.push(cur); cur = null; }
      cx = sx; cy = sy;
    }
  }
  if (cur && cur.length > 1) subpaths.push(cur);
  return subpaths;
}

const ellipse = (cx, cy, rx, ry, n = 96) =>
  [Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)];
  })];

// --- Raster -----------------------------------------------------------------
// Premultiplied float RGBA at the supersampled resolution; source-over.

function makeCanvas(size) {
  return { size, px: new Float64Array(size * size * 4) };
}

function blend(cv, i, r, g, b, a) {
  if (a <= 0) return;
  const inv = 1 - a;
  cv.px[i] = r * a + cv.px[i] * inv;
  cv.px[i + 1] = g * a + cv.px[i + 1] * inv;
  cv.px[i + 2] = b * a + cv.px[i + 2] * inv;
  cv.px[i + 3] = a + cv.px[i + 3] * inv;
}

/** Scanline fill, nonzero winding, over a set of subpaths in design space. */
function fillPolys(cv, polys, color, opacity = 1) {
  const [r, g, b, ca] = parseColor(color);
  const alpha = ca * opacity;
  if (alpha <= 0) return;
  const k = cv.size / DESIGN;
  const edges = [];
  let minY = Infinity, maxY = -Infinity;
  for (const poly of polys) {
    for (let i = 0; i + 1 < poly.length; i++) {
      const y0 = poly[i][1] * k, y1 = poly[i + 1][1] * k;
      if (y0 === y1) continue;
      edges.push([poly[i][0] * k, y0, poly[i + 1][0] * k, y1]);
      minY = Math.min(minY, y0, y1); maxY = Math.max(maxY, y0, y1);
    }
    // Close implicitly for fill (SVG fills treat subpaths as closed).
    const [fx, fy] = poly[0], [lx, ly] = poly[poly.length - 1];
    if (fx !== lx || fy !== ly) {
      const y0 = ly * k, y1 = fy * k;
      if (y0 !== y1) { edges.push([lx * k, y0, fx * k, y1]); minY = Math.min(minY, y0, y1); maxY = Math.max(maxY, y0, y1); }
    }
  }
  if (!edges.length) return;
  const yStart = Math.max(0, Math.floor(minY)), yEnd = Math.min(cv.size - 1, Math.ceil(maxY));
  const xs = [];
  for (let y = yStart; y <= yEnd; y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (const [ax, ay, bx, by] of edges) {
      if (sy >= Math.min(ay, by) && sy < Math.max(ay, by)) {
        xs.push([ax + ((sy - ay) / (by - ay)) * (bx - ax), by > ay ? 1 : -1]);
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p[0] - q[0]);
    let wind = 0;
    for (let i = 0; i < xs.length - 1; i++) {
      wind += xs[i][1];
      if (wind === 0) continue;
      const x0 = Math.max(0, Math.ceil(xs[i][0] - 0.5)), x1 = Math.min(cv.size - 1, Math.floor(xs[i + 1][0] - 0.5));
      for (let x = x0; x <= x1; x++) blend(cv, (y * cv.size + x) * 4, r, g, b, alpha);
    }
  }
}

/** Stroke as distance-to-polyline (round caps and joins). */
function strokePolys(cv, polys, color, width, opacity = 1) {
  const [r, g, b, ca] = parseColor(color);
  const alpha = ca * opacity;
  if (alpha <= 0) return;
  const k = cv.size / DESIGN;
  const hw = (width * k) / 2;
  const segs = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polys) {
    for (let i = 0; i + 1 < poly.length; i++) {
      const ax = poly[i][0] * k, ay = poly[i][1] * k, bx = poly[i + 1][0] * k, by = poly[i + 1][1] * k;
      segs.push([ax, ay, bx, by]);
      minX = Math.min(minX, ax, bx); maxX = Math.max(maxX, ax, bx);
      minY = Math.min(minY, ay, by); maxY = Math.max(maxY, ay, by);
    }
  }
  if (!segs.length) return;
  const x0 = Math.max(0, Math.floor(minX - hw - 1)), x1 = Math.min(cv.size - 1, Math.ceil(maxX + hw + 1));
  const y0 = Math.max(0, Math.floor(minY - hw - 1)), y1 = Math.min(cv.size - 1, Math.ceil(maxY + hw + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      let best = Infinity;
      for (const [ax, ay, bx, by] of segs) {
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
        const d = (px - (ax + dx * t)) ** 2 + (py - (ay + dy * t)) ** 2;
        if (d < best) best = d;
      }
      if (Math.sqrt(best) <= hw) blend(cv, (y * cv.size + x) * 4, r, g, b, alpha);
    }
  }
}

/** Vertical linear gradient across the whole design box. */
function fillGradient(cv, top, bottom) {
  const [r0, g0, b0] = parseColor(top);
  const [r1, g1, b1] = parseColor(bottom);
  for (let y = 0; y < cv.size; y++) {
    const t = (y + 0.5) / cv.size;
    const r = r0 + (r1 - r0) * t, g = g0 + (g1 - g0) * t, b = b0 + (b1 - b0) * t;
    for (let x = 0; x < cv.size; x++) blend(cv, (y * cv.size + x) * 4, r, g, b, 1);
  }
}

/** Multiplies alpha by an antialiased disc — the chip's clip. */
function clipToCircle(cv, cx, cy, radius) {
  const k = cv.size / DESIGN;
  const ccx = cx * k, ccy = cy * k, cr = radius * k;
  for (let y = 0; y < cv.size; y++) {
    for (let x = 0; x < cv.size; x++) {
      const d = Math.hypot(x + 0.5 - ccx, y + 0.5 - ccy);
      const cov = Math.max(0, Math.min(1, cr + 0.5 - d));
      if (cov >= 1) continue;
      const i = (y * cv.size + x) * 4;
      cv.px[i] *= cov; cv.px[i + 1] *= cov; cv.px[i + 2] *= cov; cv.px[i + 3] *= cov;
    }
  }
}

/** Box-downsamples the supersampled canvas and un-premultiplies to RGBA8. */
function resolve(cv, outSize) {
  const out = Buffer.alloc(outSize * outSize * 4);
  const n = cv.size / outSize;
  for (let y = 0; y < outSize; y++) {
    for (let x = 0; x < outSize; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
          const i = ((y * n + sy) * cv.size + (x * n + sx)) * 4;
          r += cv.px[i]; g += cv.px[i + 1]; b += cv.px[i + 2]; a += cv.px[i + 3];
        }
      }
      const c = n * n;
      r /= c; g /= c; b /= c; a /= c;
      const o = (y * outSize + x) * 4;
      out[o] = a > 0 ? Math.round(Math.min(255, r / a)) : 0;
      out[o + 1] = a > 0 ? Math.round(Math.min(255, g / a)) : 0;
      out[o + 2] = a > 0 ? Math.round(Math.min(255, b / a)) : 0;
      out[o + 3] = Math.round(Math.min(255, a * 255));
    }
  }
  return out;
}

/** Renders one avatar to RGBA8 at `size`. Mirrors AvatarGlyph's draw order. */
export function renderAvatar(spec, size = OUT_SIZE) {
  const cv = makeCanvas(size * SS);
  const tone = CHIP_TONES[spec.tone];
  if (!tone) throw new Error(`${spec.id}: unknown chip tone ${spec.tone}`);
  fillGradient(cv, tone.top, tone.bottom);
  for (const o of [...chipOps(spec), ...buildOps(spec)]) {
    switch (o.t) {
      case "path": fillPolys(cv, parsePath(o.d), o.fill, o.op ?? 1); break;
      case "stroke": strokePolys(cv, parsePath(o.d), o.color, o.w, o.op ?? 1); break;
      case "circle": fillPolys(cv, ellipse(o.cx, o.cy, o.r, o.r), o.fill, o.op ?? 1); break;
      case "oval": fillPolys(cv, ellipse(o.cx, o.cy, o.rx, o.ry), o.fill, o.op ?? 1); break;
      case "ring": strokePolys(cv, ellipse(o.cx, o.cy, o.r, o.r), o.color, o.w, o.op ?? 1); break;
      default: throw new Error(`unknown op: ${o.t}`);
    }
  }
  // The rim sits inside r=50, so drawing it before the clip is equivalent to
  // the runtime version drawing it outside the clip group.
  strokePolys(cv, ellipse(50, 50, 49, 49), "rgba(0,0,0,0.15)", 2);
  clipToCircle(cv, 50, 50, 50);
  return resolve(cv, size);
}

// --- PNG (same hand-rolled encoder as gen-app-icon.mjs) ----------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crc]);
}
export function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// --- Emit -------------------------------------------------------------------

export const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "images", "avatars");

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const spec of AVATARS) {
    const png = encodePNG(OUT_SIZE, renderAvatar(spec, OUT_SIZE));
    writeFileSync(join(OUT_DIR, `${spec.id}.png`), png);
    console.log(`Wrote ${spec.id}.png (${OUT_SIZE}x${OUT_SIZE}, ${png.length} bytes)`);
  }
}

// Importable by tests without regenerating the art.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
