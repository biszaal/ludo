/**
 * Renders the avatar chips to PNG — the raster half of the avatar pipeline.
 *
 * What the characters LOOK like lives in scripts/avatar-art.mjs, which draws
 * each one as an SVG string. This file is the engine underneath: it parses that
 * SVG into flattened polylines and fills/strokes them with the same pure-Node
 * rasterizer and hand-rolled PNG encoder as gen-app-icon.mjs / gen-emoji.mjs.
 * The app only knows the ids and the image files; src/render/avatars.ts holds
 * the id list and the require() map. Nothing regenerates at build time — if you
 * change art, re-run this and commit the PNGs.
 *
 * Why an SVG layer at all. The art used to be written directly as the engine's
 * own op objects in a 100x100 space, which meant the drawing code and the
 * rasterizer could only ever be read together. Avatar set v2 is a parametric
 * library (face shapes x eye kits x brows x mouths x hair), and that is far
 * easier to write, review and diff as SVG — so the engine grew a parser for the
 * subset the art actually emits, and throws on anything outside it rather than
 * silently drawing nothing.
 *
 * Rendering notes:
 *  - Geometry is the SVG's own 512x512 space; the chip is the disc r=250.
 *  - Fills use scanline + nonzero winding. Strokes use distance-to-polyline,
 *    with round joins always and butt caps unless stroke-linecap says round.
 *  - 3x supersampled, then box-downsampled, matching the sibling generators.
 *
 * Run: node scripts/gen-avatars.mjs
 * Outputs: assets/images/avatars/<id>.png (512px, transparent outside the chip)
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

import { AVATARS, CHIP_TONES, buildSVG } from "./avatar-art.mjs";

export { AVATARS, CHIP_TONES, buildSVG };

const OUT_SIZE = 512;
const SS = 3; // supersample factor, as in gen-app-icon.mjs
const DESIGN = 512; // the coordinate space the art is written in

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

/** HSL saturation, 0-1; NaN for non-hex input. Guards busts against seat colors. */
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

/** WCAG contrast ratio, 1-21. Guards a silhouette against vanishing into the chip. */
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
//
// Every command the art emits, absolute and relative: M L H V C S Q Z A. The
// previous version of this parser upper-cased the command letter, which is
// correct only for absolute paths — v2's art is written largely in relative
// curves, where that silently drew the wrong shape rather than failing.

const CUBIC_STEPS = 24;
const QUAD_STEPS = 16;

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

const PATH_CMD = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
const nums = (s) => (s.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);

/**
 * Parses a path `d` into subpaths of flattened points.
 *
 * Each subpath carries `closed`, because a stroke needs to know: an open
 * polyline gets caps at its ends, a closed one gets a join there instead. Fills
 * ignore it — SVG closes every subpath implicitly when filling.
 */
export function parsePath(d) {
  const subpaths = [];
  let cur = null;
  let cx = 0, cy = 0, sx = 0, sy = 0;
  // Reflection point for a smooth curve continuing the previous one.
  let lastC = null, lastQ = null;
  const push = (closed) => {
    if (cur && cur.pts.length > 1) { cur.closed = closed; subpaths.push(cur); }
    cur = null;
  };
  const open = () => { if (!cur) cur = { pts: [[cx, cy]], closed: false }; };
  const cubic = (x1, y1, x2, y2, x, y) => {
    open();
    for (let s = 1; s <= CUBIC_STEPS; s++) {
      const t = s / CUBIC_STEPS, u = 1 - t;
      cur.pts.push([
        u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
        u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
      ]);
    }
    lastC = [x2, y2]; lastQ = null;
    cx = x; cy = y;
  };
  const quad = (x1, y1, x, y) => {
    open();
    for (let s = 1; s <= QUAD_STEPS; s++) {
      const t = s / QUAD_STEPS, u = 1 - t;
      cur.pts.push([u * u * cx + 2 * u * t * x1 + t * t * x, u * u * cy + 2 * u * t * y1 + t * t * y]);
    }
    lastQ = [x1, y1]; lastC = null;
    cx = x; cy = y;
  };
  const line = (x, y) => { open(); cur.pts.push([x, y]); lastC = null; lastQ = null; cx = x; cy = y; };

  for (const m of d.matchAll(PATH_CMD)) {
    const cmd = m[1];
    const rel = cmd === cmd.toLowerCase() && cmd !== "Z" && cmd !== "z";
    const a = nums(m[2]);
    const ox = () => (rel ? cx : 0);
    const oy = () => (rel ? cy : 0);
    switch (cmd.toUpperCase()) {
      case "M": {
        if (a.length < 2) break;
        push(false);
        cx = a[0] + ox(); cy = a[1] + oy(); sx = cx; sy = cy;
        cur = { pts: [[cx, cy]], closed: false };
        lastC = null; lastQ = null;
        // Extra coordinate pairs after an M are implicit L commands.
        for (let i = 2; i + 1 < a.length; i += 2) line(a[i] + ox(), a[i + 1] + oy());
        break;
      }
      case "L": for (let i = 0; i + 1 < a.length; i += 2) line(a[i] + ox(), a[i + 1] + oy()); break;
      case "H": for (const v of a) line(v + ox(), cy); break;
      case "V": for (const v of a) line(cx, v + oy()); break;
      case "C":
        for (let i = 0; i + 5 < a.length; i += 6) {
          cubic(a[i] + ox(), a[i + 1] + oy(), a[i + 2] + ox(), a[i + 3] + oy(), a[i + 4] + ox(), a[i + 5] + oy());
        }
        break;
      case "S":
        for (let i = 0; i + 3 < a.length; i += 4) {
          // The first control point mirrors the previous curve's second one.
          const rx = lastC ? 2 * cx - lastC[0] : cx;
          const ry = lastC ? 2 * cy - lastC[1] : cy;
          cubic(rx, ry, a[i] + ox(), a[i + 1] + oy(), a[i + 2] + ox(), a[i + 3] + oy());
        }
        break;
      case "Q":
        for (let i = 0; i + 3 < a.length; i += 4) quad(a[i] + ox(), a[i + 1] + oy(), a[i + 2] + ox(), a[i + 3] + oy());
        break;
      case "T":
        for (let i = 0; i + 1 < a.length; i += 2) {
          const rx = lastQ ? 2 * cx - lastQ[0] : cx;
          const ry = lastQ ? 2 * cy - lastQ[1] : cy;
          quad(rx, ry, a[i] + ox(), a[i + 1] + oy());
        }
        break;
      case "A":
        for (let i = 0; i + 6 < a.length; i += 7) {
          const [rx, ry, rot, laf, sf] = a.slice(i, i + 5);
          const x = a[i + 5] + ox(), y = a[i + 6] + oy();
          open();
          cur.pts.push(...arcPoints(cx, cy, rx, ry, rot, laf, sf, x, y));
          lastC = null; lastQ = null;
          cx = x; cy = y;
        }
        break;
      case "Z":
        if (cur) { cur.pts.push([sx, sy]); push(true); }
        cx = sx; cy = sy;
        lastC = null; lastQ = null;
        break;
      default: throw new Error(`unsupported path command: ${cmd}`);
    }
  }
  push(false);
  return subpaths;
}

const ellipsePolys = (cx, cy, rx, ry, n = 128) => [{
  closed: true,
  pts: Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)];
  }),
}];

/** A rounded rectangle, as SVG's `rect` with rx/ry defines it. */
function rectPolys(x, y, w, h, rx, ry) {
  rx = Math.min(rx ?? 0, w / 2);
  ry = Math.min(ry ?? rx, h / 2);
  if (rx <= 0 || ry <= 0) {
    return [{ closed: true, pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]] }];
  }
  return parsePath(
    `M${x + rx} ${y} H${x + w - rx} A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}` +
    ` V${y + h - ry} A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}` +
    ` H${x + rx} A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}` +
    ` V${y + ry} A${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`,
  );
}

// --- SVG document -> draw ops ------------------------------------------------

const IDENTITY = [1, 0, 0, 1, 0, 0];
const matMul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const applyMat = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** `rotate(a[ cx cy])`, `translate(x[,y])` and `scale(s[,sy])`, composed left to right. */
function parseTransform(s) {
  let m = IDENTITY;
  for (const t of s.matchAll(/([a-z]+)\s*\(([^)]*)\)/gi)) {
    const a = nums(t[2]);
    switch (t[1]) {
      case "translate": m = matMul(m, [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]); break;
      case "scale": m = matMul(m, [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]); break;
      case "rotate": {
        const r = ((a[0] ?? 0) * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
        const [px, py] = [a[1] ?? 0, a[2] ?? 0];
        m = matMul(m, [1, 0, 0, 1, px, py]);
        m = matMul(m, [c, sn, -sn, c, 0, 0]);
        m = matMul(m, [1, 0, 0, 1, -px, -py]);
        break;
      }
      default: throw new Error(`unsupported transform: ${t[1]}`);
    }
  }
  return m;
}

const TAG = /<(\/?)([a-zA-Z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
const ATTR = /([\w:.-]+)\s*=\s*"([^"]*)"/g;

/** Elements whose contents never draw: definitions, clips and provenance. */
const SKIPPED = new Set(["defs", "clippath", "metadata", "lineargradient", "radialgradient", "c2pa:manifest"]);

/** Style properties that cascade from a `g` to its children. */
const INHERITED = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-dasharray"];

/**
 * Flattens an SVG document into `{ polys, fill | stroke }` draw ops.
 *
 * Deliberately narrow: it understands the shapes, attributes and transforms the
 * avatar art emits and throws on everything else. A permissive parser that
 * shrugged at an unknown element would ship a face with a missing feature and
 * no error, which is the one failure mode a generated-art pipeline cannot see.
 */
export function svgToOps(svg) {
  const ops = [];
  const stack = [{ style: {}, mat: IDENTITY }];
  let skipDepth = 0;
  let skipAt = 0;

  for (const m of svg.matchAll(TAG)) {
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    const selfClosing = m[4] === "/";

    if (skipDepth > 0) {
      if (closing && --skipAt === 0) skipDepth = 0;
      else if (!closing && !selfClosing) skipAt++;
      continue;
    }
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (SKIPPED.has(name)) {
      if (!selfClosing) { skipDepth = 1; skipAt = 1; }
      continue;
    }

    const attrs = {};
    for (const a of m[3].matchAll(ATTR)) attrs[a[1].toLowerCase()] = a[2];

    const parent = stack[stack.length - 1];
    const style = { ...parent.style };
    for (const k of INHERITED) if (attrs[k] !== undefined) style[k] = attrs[k];
    // Group opacity is multiplicative here rather than composited through an
    // offscreen buffer. The art only ever puts opacity on groups of shapes that
    // do not overlap each other, where the two are identical.
    style.opacity = (parent.style.opacity ?? 1) * (attrs.opacity !== undefined ? Number(attrs.opacity) : 1);
    const mat = attrs.transform ? matMul(parent.mat, parseTransform(attrs.transform)) : parent.mat;

    // Every element that is not self-closing gets a frame, shapes included —
    // the art writes `<circle .../>` but the reference sheet writes
    // `<circle ...></circle>`, and popping on a close that never pushed
    // unbalances the stack. Once it does, children inherit the root's empty
    // style and every `fill` from an enclosing `g` silently becomes black.
    if (!selfClosing) stack.push({ style, mat });
    if (name === "svg" || name === "g") continue;

    let polys;
    switch (name) {
      case "path": polys = parsePath(attrs.d ?? ""); break;
      case "circle": polys = ellipsePolys(+attrs.cx, +attrs.cy, +attrs.r, +attrs.r); break;
      case "ellipse": polys = ellipsePolys(+attrs.cx, +attrs.cy, +attrs.rx, +attrs.ry); break;
      case "rect": polys = rectPolys(+attrs.x || 0, +attrs.y || 0, +attrs.width, +attrs.height, attrs.rx === undefined ? 0 : +attrs.rx, attrs.ry === undefined ? undefined : +attrs.ry); break;
      case "line": polys = [{ closed: false, pts: [[+attrs.x1, +attrs.y1], [+attrs.x2, +attrs.y2]] }]; break;
      default: throw new Error(`unsupported SVG element: <${name}>`);
    }
    if (mat !== IDENTITY) polys = polys.map((p) => ({ ...p, pts: p.pts.map((pt) => applyMat(mat, pt)) }));

    // SVG's initial fill is black; only `line` has no fill at all.
    const fill = attrs.fill ?? style.fill ?? (name === "line" ? "none" : "#000000");
    const stroke = attrs.stroke ?? style.stroke ?? "none";
    if (fill !== "none" && name !== "line") ops.push({ polys, fill, opacity: style.opacity });
    if (stroke !== "none") {
      // A stroke scales with its transform, as SVG defines it. Nothing in the
      // v2 art scales, but the preserved v1 Onyx is written in its original
      // 100-unit space under one `scale(5)`, and without this its outlines
      // would come out five times too thin.
      const scale = Math.sqrt(Math.abs(mat[0] * mat[3] - mat[1] * mat[2])) || 1;
      ops.push({
        polys,
        stroke,
        width: Number(attrs["stroke-width"] ?? style["stroke-width"] ?? 1) * scale,
        cap: attrs["stroke-linecap"] ?? style["stroke-linecap"] ?? "butt",
        dash: (attrs["stroke-dasharray"] ?? style["stroke-dasharray"] ?? "none") === "none"
          ? null
          : nums(attrs["stroke-dasharray"] ?? style["stroke-dasharray"]),
        opacity: style.opacity,
      });
    }
  }
  return ops;
}

/** Cuts a polyline into the "on" runs of a dash pattern. */
function dashPolys(polys, pattern) {
  if (!pattern || !pattern.length) return polys;
  const total = pattern.reduce((a, b) => a + b, 0);
  if (total <= 0) return polys;
  const out = [];
  for (const poly of polys) {
    let idx = 0, left = pattern[0], on = true, run = [poly.pts[0]];
    for (let i = 0; i + 1 < poly.pts.length; i++) {
      let [ax, ay] = poly.pts[i];
      const [bx, by] = poly.pts[i + 1];
      let seg = Math.hypot(bx - ax, by - ay);
      while (seg > left) {
        const t = left / seg;
        const mx = ax + (bx - ax) * t, my = ay + (by - ay) * t;
        if (on) { run.push([mx, my]); if (run.length > 1) out.push({ closed: false, pts: run }); }
        run = [[mx, my]];
        on = !on;
        ax = mx; ay = my;
        seg -= left;
        idx = (idx + 1) % pattern.length;
        left = pattern[idx];
      }
      left -= seg;
      if (on) run.push([bx, by]);
      else run = [[bx, by]];
    }
    if (on && run.length > 1) out.push({ closed: false, pts: run });
  }
  return out;
}

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
  for (const { pts } of polys) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const y0 = pts[i][1] * k, y1 = pts[i + 1][1] * k;
      if (y0 === y1) continue;
      edges.push([pts[i][0] * k, y0, pts[i + 1][0] * k, y1]);
      minY = Math.min(minY, y0, y1); maxY = Math.max(maxY, y0, y1);
    }
    // Close implicitly for fill (SVG fills treat subpaths as closed).
    const [fx, fy] = pts[0], [lx, ly] = pts[pts.length - 1];
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

/**
 * Stroke as distance-to-polyline: round joins always, and butt caps unless the
 * art asked for round ones.
 *
 * A butt cap is the half-plane test at each end of an open polyline. Without
 * it every unclosed stroke grows by half its width at both ends, which on the
 * art's thick bands (a turban wrap is 16 units wide) pushes past the shape it
 * is meant to sit inside.
 */
function strokePolys(cv, polys, color, width, cap = "butt", opacity = 1) {
  const [r, g, b, ca] = parseColor(color);
  const alpha = ca * opacity;
  if (alpha <= 0 || width <= 0) return;
  const k = cv.size / DESIGN;
  const hw = (width * k) / 2;
  const segs = [];
  const planes = []; // [px, py, nx, ny] — reject samples on the far side
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { pts, closed } of polys) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const ax = pts[i][0] * k, ay = pts[i][1] * k, bx = pts[i + 1][0] * k, by = pts[i + 1][1] * k;
      segs.push([ax, ay, bx, by]);
      minX = Math.min(minX, ax, bx); maxX = Math.max(maxX, ax, bx);
      minY = Math.min(minY, ay, by); maxY = Math.max(maxY, ay, by);
    }
    if (cap === "round" || closed || pts.length < 2) continue;
    const dir = (from, to) => {
      const d = Math.hypot(to[0] - from[0], to[1] - from[1]);
      return d ? [(to[0] - from[0]) / d, (to[1] - from[1]) / d] : null;
    };
    const head = dir(pts[0], pts[1]);
    const tail = dir(pts[pts.length - 2], pts[pts.length - 1]);
    if (head) planes.push([pts[0][0] * k, pts[0][1] * k, -head[0], -head[1]]);
    if (tail) planes.push([pts[pts.length - 1][0] * k, pts[pts.length - 1][1] * k, tail[0], tail[1]]);
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
      if (Math.sqrt(best) > hw) continue;
      let clipped = false;
      for (const [qx, qy, nx, ny] of planes) {
        if ((px - qx) * nx + (py - qy) * ny > 0 && Math.hypot(px - qx, py - qy) <= hw) { clipped = true; break; }
      }
      if (clipped) continue;
      blend(cv, (y * cv.size + x) * 4, r, g, b, alpha);
    }
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

/** Rasterizes an SVG string to RGBA8 at `size`, clipped to the chip disc. */
export function renderSVG(svg, size = OUT_SIZE) {
  const cv = makeCanvas(size * SS);
  for (const op of svgToOps(svg)) {
    if (op.fill) fillPolys(cv, op.polys, op.fill, op.opacity);
    else strokePolys(cv, dashPolys(op.polys, op.dash), op.stroke, op.width, op.cap, op.opacity);
  }
  clipToCircle(cv, 256, 256, 250);
  return resolve(cv, size);
}

/** Renders one avatar to RGBA8 at `size`. */
export function renderAvatar(spec, size = OUT_SIZE) {
  return renderSVG(buildSVG(spec), size);
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
