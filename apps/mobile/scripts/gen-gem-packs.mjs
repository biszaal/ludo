/**
 * Gem pack artwork as PNGs, for the store listings.
 *
 * The packs are drawn in the app by components/GemHoard.tsx (pure Skia, three
 * tiers of the same faceted gem: loose stones, a heaped pile, a chest with the
 * lid thrown back). The store needs flat images of the same thing, and a
 * screenshot would carry the wrong background and the wrong resolution.
 *
 * So this re-renders the artwork from the SAME numbers rather than tracing it:
 * GEM_POINTS, LAYOUTS, the chest paths and every colour below are copied from
 * GemHoard.tsx verbatim. If that file's geometry changes, change it here too —
 * the two are kept in step by hand, which is the cost of not shipping a
 * headless Skia toolchain just for three images.
 *
 * Pure Node, no dependencies: same posture as gen-app-icon.mjs, which encodes
 * PNG by hand (zlib + CRC32). Paths are flattened to polygons and filled by
 * supersampled point-in-polygon, which is enough for shapes made of straight
 * edges and two quadratics.
 *
 *   node apps/mobile/scripts/gen-gem-packs.mjs
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "..", "..", "store-assets", "gem-packs");

// --- palette (theme.ts + GemHoard.tsx) --------------------------------------

const TABLE = "#8A7BFF"; // gem crown
const PAVILION = "#5B4BD6"; // gem underside
const SPECULAR = "#C9C2FF"; // gem edge highlight
const BAND = "#EFB728"; // marigold, teamColor.yellow
const LIFTED_SLATE = "#242932";
const RAISED_SLATE = "#1C2026";
const FELT = "#14171C"; // the app's ground, for the flattened variant

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// --- geometry, copied from GemHoard.tsx -------------------------------------

/** The gem silhouette, as unit-space t values. Mirrors gemPath(). */
const GEM_T = [
  [0.3, 0.12],
  [0.7, 0.12],
  [0.94, 0.42],
  [0.5, 0.92],
  [0.06, 0.42],
];

/** One gem as absolute points, centred on (cx, cy) with width w. h = w * 1.05. */
function gemPoints(cx, cy, w) {
  const h = w * 1.05;
  return GEM_T.map(([tx, ty]) => [cx + (tx - 0.5) * w, cy + (ty - 0.5) * h]);
}

const LAYOUTS = {
  small: [
    { cx: 0.5, cy: 0.4, w: 0.34 },
    { cx: 0.31, cy: 0.62, w: 0.28 },
    { cx: 0.68, cy: 0.63, w: 0.26 },
  ],
  medium: [
    { cx: 0.22, cy: 0.68, w: 0.3 },
    { cx: 0.5, cy: 0.72, w: 0.34 },
    { cx: 0.78, cy: 0.68, w: 0.3 },
    { cx: 0.35, cy: 0.45, w: 0.3 },
    { cx: 0.65, cy: 0.45, w: 0.3 },
    { cx: 0.5, cy: 0.24, w: 0.32 },
  ],
  large: [
    { cx: 0.28, cy: 0.36, w: 0.26 },
    { cx: 0.5, cy: 0.26, w: 0.32 },
    { cx: 0.72, cy: 0.36, w: 0.26 },
    { cx: 0.5, cy: 0.46, w: 0.26 },
  ],
};

const BODY_TOP = 0.52;

/** Flatten one quadratic bézier to line segments. 24 is well past the point
 *  where more segments change a pixel at 1024. */
function quad(p0, c, p1, steps = 24) {
  const out = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const m = 1 - t;
    out.push([
      m * m * p0[0] + 2 * m * t * c[0] + t * t * p1[0],
      m * m * p0[1] + 2 * m * t * c[1] + t * t * p1[1],
    ]);
  }
  return out;
}

/** The chest, in unit space. Body, thrown-back lid, and the centre strap. */
function chestShapes() {
  const body = [[0.12, BODY_TOP], [0.88, BODY_TOP], [0.84, 0.9]];
  body.push(...quad([0.84, 0.9], [0.5, 0.96], [0.16, 0.9]));

  const lid = [[0.14, BODY_TOP]];
  lid.push(...quad([0.14, BODY_TOP], [0.5, 0.3], [0.86, BODY_TOP]));
  lid.push([0.86, BODY_TOP - 0.06]);
  lid.push(...quad([0.86, BODY_TOP - 0.06], [0.5, 0.22], [0.14, BODY_TOP - 0.06]));

  const strap = [[0.44, BODY_TOP], [0.56, BODY_TOP], [0.55, 0.92], [0.45, 0.92]];
  return { body, lid, strap };
}

// --- rasterising -------------------------------------------------------------

function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

function inside(pts, x, y) {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Distance from a point to the closed polyline — the stroke test. */
function edgeDistance(pts, x, y) {
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [x1, y1] = pts[j];
    const [x2, y2] = pts[i];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
    const px = x1 + t * dx;
    const py = y1 + t * dy;
    const d = Math.hypot(x - px, y - py);
    if (d < best) best = d;
  }
  return best;
}

/** Paint `src` over `dst` (both [r,g,b,a] 0-255) at the given alpha. */
function over(dst, src, alpha) {
  const a = alpha;
  if (a <= 0) return dst;
  const outA = a + dst[3] * (1 - a);
  if (outA <= 0) return [0, 0, 0, 0];
  return [
    (src[0] * a + dst[0] * dst[3] * (1 - a)) / outA,
    (src[1] * a + dst[1] * dst[3] * (1 - a)) / outA,
    (src[2] * a + dst[2] * dst[3] * (1 - a)) / outA,
    outA,
  ];
}

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * The draw list for one tier, in paint order, in unit space.
 *
 * Mirrors GemHoard's JSX exactly: for `large` the chest is drawn first so the
 * stones sit IN it rather than on it.
 */
function drawList(tier) {
  const ops = [];

  if (tier === "large") {
    const { body, lid, strap } = chestShapes();
    ops.push({ kind: "fill", pts: lid, color: hex(LIFTED_SLATE) });
    ops.push({ kind: "stroke", pts: lid, color: hex(BAND), width: 0.02 });
    ops.push({ kind: "fillY", pts: body, from: hex(LIFTED_SLATE), to: hex(RAISED_SLATE), y0: BODY_TOP, y1: 1 });
    ops.push({ kind: "fill", pts: strap, color: hex(BAND), alpha: 0.85 });
    ops.push({ kind: "stroke", pts: body, color: hex(BAND), width: 0.022, alpha: 0.9 });
  }

  for (const g of LAYOUTS[tier]) {
    const pts = gemPoints(g.cx, g.cy, g.w);
    ops.push({
      kind: "fillY",
      pts,
      from: hex(TABLE),
      to: hex(PAVILION),
      y0: g.cy - g.w / 2,
      y1: g.cy + g.w / 2,
    });
    ops.push({ kind: "stroke", pts, color: hex(SPECULAR), width: 0.016 });
  }
  return ops;
}

/** Render one tier at `size`, supersampled. `bg` null = transparent. */
function render(tier, size, bg) {
  const ops = drawList(tier).map((op) => ({
    ...op,
    abs: op.pts.map(([x, y]) => [x * size, y * size]),
  }));
  for (const op of ops) op.box = bbox(op.abs);

  const SS = 3; // 9 samples per pixel — plenty for edges this soft
  const px = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS;
          const fy = y + (sy + 0.5) / SS;
          let c = bg ? [...hex(bg), 1] : [0, 0, 0, 0];

          for (const op of ops) {
            const [bx0, by0, bx1, by1] = op.box;
            const pad = op.kind === "stroke" ? op.width * size : 0;
            if (fx < bx0 - pad || fx > bx1 + pad || fy < by0 - pad || fy > by1 + pad) continue;

            if (op.kind === "stroke") {
              const half = Math.max(1, op.width * size) / 2;
              if (edgeDistance(op.abs, fx, fy) <= half) {
                c = over(c, op.color, op.alpha ?? 1);
              }
            } else if (inside(op.abs, fx, fy)) {
              if (op.kind === "fillY") {
                const t = Math.max(0, Math.min(1, (fy / size - op.y0) / (op.y1 - op.y0)));
                const col = [
                  lerp(op.from[0], op.to[0], t),
                  lerp(op.from[1], op.to[1], t),
                  lerp(op.from[2], op.to[2], t),
                ];
                c = over(c, col, 1);
              } else {
                c = over(c, op.color, op.alpha ?? 1);
              }
            }
          }

          r += c[0] * c[3];
          g += c[1] * c[3];
          b += c[2] * c[3];
          a += c[3];
        }
      }

      const n = SS * SS;
      const i = (y * size + x) * 4;
      const alpha = a / n;
      px[i] = alpha > 0 ? Math.round(r / a) : 0;
      px[i + 1] = alpha > 0 ? Math.round(g / a) : 0;
      px[i + 2] = alpha > 0 ? Math.round(b / a) : 0;
      px[i + 3] = Math.round(alpha * 255);
    }
  }
  return px;
}

// --- PNG (same hand-rolled encoder as gen-app-icon.mjs) ----------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * Encode RGBA pixels as PNG. `alpha: false` drops the channel entirely rather
 * than writing it opaque — App Store Connect rejects a promotional image that
 * CARRIES an alpha channel, whether or not anything in it is transparent, so
 * "every pixel is opaque" is not good enough.
 */
function png(width, height, rgba, alpha = true) {
  const ch = alpha ? 4 : 3;
  const stride = width * ch + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    if (alpha) {
      rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
    } else {
      for (let x = 0; x < width; x++) {
        const src = (y * width + x) * 4;
        const dst = y * stride + 1 + x * 3;
        raw[dst] = rgba[src];
        raw[dst + 1] = rgba[src + 1];
        raw[dst + 2] = rgba[src + 2];
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = alpha ? 6 : 2; // truecolour + alpha, or plain truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- main --------------------------------------------------------------------

const TIERS = [
  ["small", "gems.small", "Handful of Gems"],
  ["medium", "gems.medium", "Pouch of Gems"],
  ["large", "gems.large", "Chest of Gems"],
];

mkdirSync(OUT_DIR, { recursive: true });

for (const [tier, sku, name] of TIERS) {
  for (const [suffix, size, bg] of [
    // App Store Connect promotional image: 1024x1024, and it must be FLAT —
    // an alpha channel is rejected, so this one gets the app's own ground.
    ["1024", 1024, FELT],
    // Transparent, for anywhere it sits on its own background (a press kit,
    // a web page, a slide).
    ["1024-transparent", 1024, null],
    // Small flat copy, handy for a spreadsheet or a listing preview.
    ["256", 256, FELT],
  ]) {
    const file = join(OUT_DIR, `${sku}-${suffix}.png`);
    // A background means a flat image, and a flat image ships without alpha.
    writeFileSync(file, png(size, size, render(tier, size, bg), bg === null));
    console.log(`  ${name.padEnd(16)} -> ${file.replace(process.cwd() + "/", "")}`);
  }
}

console.log(`\nDone. ${TIERS.length * 3} files in ${OUT_DIR.replace(process.cwd() + "/", "")}`);
console.log("Upload the plain -1024.png to App Store Connect (no alpha allowed).");
console.log("Google Play in-app products have no image field — nothing to upload there.");
