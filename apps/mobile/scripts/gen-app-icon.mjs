/**
 * Generates the Ludo app icons — pure Node, no native deps. Renders a top-down
 * Ludo board mark (four color quadrants + white cross + a center die with
 * brand-colored pips) with 3x supersampled anti-aliasing, and encodes PNGs by
 * hand (zlib + CRC32).
 *
 * Run: node scripts/gen-app-icon.mjs
 * Outputs: icon.png, android-icon-foreground/background/monochrome.png, favicon.png
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// --- Palette (matches the in-game board) -----------------------------------
const RED = [229, 72, 77];
const GREEN = [47, 169, 104];
const YELLOW = [239, 183, 40];
const BLUE = [62, 99, 221];
const WHITE = [255, 255, 255];
const CROSS = [247, 246, 241];
const DARK = [20, 23, 28];
const FELT = [20, 23, 28];
const T = [0, 0, 0, 0]; // transparent

// --- Geometry helpers (logical 1024 space) ---------------------------------
function rrectSDF(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 < r * r;
const rgb = (c) => [c[0], c[1], c[2], 255];

// The board mark in a [0,1024) box. `round` rounds the outer corners (and makes
// the area outside transparent); 0 = full bleed.
function board(u, v, round) {
  if (round > 0 && rrectSDF(u, v, 512, 512, 512, 512, round) > 0) return T;

  let c = u < 512 ? (v < 512 ? RED : BLUE) : v < 512 ? GREEN : YELLOW;
  if (Math.abs(u - 512) < 84 || Math.abs(v - 512) < 84) c = CROSS;

  const die = rrectSDF(u, v, 512, 512, 170, 170, 58);
  if (die < 0) {
    if (die > -16) return rgb(DARK); // rim
    c = WHITE;
    const pips = [
      [426, 426, RED],
      [598, 426, GREEN],
      [426, 598, BLUE],
      [598, 598, YELLOW],
      [512, 512, DARK],
    ];
    for (const [px, py, pc] of pips) if (inCircle(u, v, px, py, 36)) return rgb(pc);
  }
  return rgb(c);
}

const iconSampler = (u, v) => board(u, v, 0);

function fgSampler(u, v) {
  const inset = 170;
  const w = 1024 - inset * 2;
  const lu = ((u - inset) / w) * 1024;
  const lv = ((v - inset) / w) * 1024;
  if (lu < 0 || lu >= 1024 || lv < 0 || lv >= 1024) return T;
  return board(lu, lv, 150);
}

const bgSampler = () => rgb(FELT);

function monoSampler(u, v) {
  if (rrectSDF(u, v, 512, 512, 300, 300, 92) >= 0) return T;
  const holes = [
    [392, 392],
    [632, 392],
    [392, 632],
    [632, 632],
    [512, 512],
  ];
  for (const [hx, hy] of holes) if (inCircle(u, v, hx, hy, 62)) return T;
  return rgb(WHITE);
}

// --- Renderer (3x supersampled) --------------------------------------------
function render(out, sampler) {
  const SS = 3;
  const buf = Buffer.alloc(out * out * 4);
  const f = 1024 / out;
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let aw = 0; // sum of alpha (0..1)
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sampler((x + (sx + 0.5) / SS) * f, (y + (sy + 0.5) / SS) * f);
          const a = c[3] / 255;
          r += c[0] * a;
          g += c[1] * a;
          b += c[2] * a;
          aw += a;
        }
      }
      const n = SS * SS;
      const idx = (y * out + x) * 4;
      const alpha = Math.round((aw / n) * 255);
      if (alpha < 1) continue; // leave transparent (zeros)
      buf[idx] = Math.round(r / aw);
      buf[idx + 1] = Math.round(g / aw);
      buf[idx + 2] = Math.round(b / aw);
      buf[idx + 3] = alpha;
    }
  }
  return buf;
}

// --- PNG encoder ------------------------------------------------------------
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
function encodePNG(size, rgba) {
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
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
mkdirSync(outDir, { recursive: true });

const files = [
  ["icon.png", 1024, iconSampler],
  ["android-icon-foreground.png", 1024, fgSampler],
  ["android-icon-background.png", 1024, bgSampler],
  ["android-icon-monochrome.png", 1024, monoSampler],
  ["favicon.png", 48, iconSampler],
];

for (const [name, size, sampler] of files) {
  const png = encodePNG(size, render(size, sampler));
  writeFileSync(join(outDir, name), png);
  console.log(`Wrote ${name} (${size}x${size}, ${png.length} bytes)`);
}
