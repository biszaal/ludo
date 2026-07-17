/**
 * Generates the in-game reaction emoji sprites — our own art, drawn in code
 * (same pure-Node SDF renderer + hand-rolled PNG encoder as gen-app-icon.mjs).
 * Golden porcelain face chips with felt-dark features and team-color accents,
 * matching the app's glossy game-piece look.
 *
 * Run: node scripts/gen-emoji.mjs
 * Outputs: assets/emoji/{laugh,cry,angry,tease,cheer,shock,thumbs,gg}.png (128px)
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// --- Palette (team colors mirror the board; face golds mirror the pieces) ---
const FACE_TOP = [255, 216, 92];
const FACE_BOT = [242, 160, 44];
const RIM = [178, 112, 22];
const INK = [42, 31, 20];
const WHITE = [255, 255, 255];
const TEAR = [86, 143, 255];
const TONGUE = [232, 84, 84];
const FLUSH = [235, 74, 56];
const SLATE = [45, 51, 62];
const SLATE_RIM = [28, 32, 40];
const GOLD = [245, 197, 66];
const GOLD_DARK = [198, 141, 26];
const RED = [229, 72, 77];
const GREEN = [47, 169, 104];
const BLUE = [62, 99, 221];
const T = [0, 0, 0, 0];
const rgb = (c) => [c[0], c[1], c[2], 255];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// --- Shape tests (logical 1024 space) ---------------------------------------
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 < r * r;
const inEllipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1;
function inCapsule(x, y, ax, ay, bx, by, r) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby) / (abx * abx + aby * aby)));
  return (x - (ax + abx * t)) ** 2 + (y - (ay + aby * t)) ** 2 < r * r;
}
function inRRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r < 0;
}
function inTriangle(x, y, [ax, ay], [bx, by], [cx, cy]) {
  const s1 = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  const s2 = (cx - bx) * (y - by) - (cy - by) * (x - bx);
  const s3 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}
/** Closed-eye arc: a crescent left between two offset discs. `up` flips sad/happy. */
const inCrescent = (x, y, cx, cy, r, up) =>
  inCircle(x, y, cx, cy, r) && !inCircle(x, y, cx, cy + (up ? 44 : -44), r + 12);

// --- Face chip ---------------------------------------------------------------
const FACE_R = 470;
function faceChip(x, y, tintFn = null) {
  const d = Math.hypot(x - 512, y - 512) - FACE_R;
  if (d > 0) return null;
  if (d > -26) return rgb(RIM);
  let c = mix(FACE_TOP, FACE_BOT, Math.max(0, Math.min(1, (y - 180) / 700)));
  if (inEllipse(x, y, 512, 330, 310, 175)) c = mix(c, WHITE, 0.16); // top gloss
  if (tintFn) c = tintFn(c, x, y);
  return rgb(c);
}
function slateChip(x, y) {
  const d = Math.hypot(x - 512, y - 512) - FACE_R;
  if (d > 0) return null;
  if (d > -26) return rgb(SLATE_RIM);
  let c = mix(SLATE, [64, 72, 86], 1 - Math.max(0, Math.min(1, (y - 180) / 700)));
  return rgb(c);
}

// --- The eight emoji samplers ------------------------------------------------
function laugh(x, y) {
  if (inCrescent(x, y, 356, 420, 74, false)) return rgb(INK);
  if (inCrescent(x, y, 668, 420, 74, false)) return rgb(INK);
  if (inCircle(x, y, 512, 610, 190) && y > 610) {
    if (y < 655) return rgb(WHITE); // teeth
    if (inEllipse(x, y, 512, 760, 118, 82)) return rgb(TONGUE);
    return rgb(INK);
  }
  return faceChip(x, y) ?? T;
}

function cry(x, y) {
  if (inCapsule(x, y, 356, 520, 356, 790, 44)) return rgb(TEAR);
  if (inCapsule(x, y, 668, 520, 668, 790, 44)) return rgb(TEAR);
  if (inCrescent(x, y, 356, 440, 70, true)) return rgb(INK);
  if (inCrescent(x, y, 668, 440, 70, true)) return rgb(INK);
  if (inCapsule(x, y, 300, 330, 420, 366, 20)) return rgb(INK); // sad brows
  if (inCapsule(x, y, 724, 330, 604, 366, 20)) return rgb(INK);
  if (inEllipse(x, y, 512, 680, 112, 92)) return rgb(INK); // wail
  return faceChip(x, y) ?? T;
}

function angry(x, y) {
  if (inCapsule(x, y, 286, 352, 442, 416, 27)) return rgb(INK); // knitted brows
  if (inCapsule(x, y, 738, 352, 582, 416, 27)) return rgb(INK);
  if (inCircle(x, y, 366, 496, 44)) return rgb(INK);
  if (inCircle(x, y, 658, 496, 44)) return rgb(INK);
  if (inRRect(x, y, 512, 680, 158, 48, 42)) {
    if (Math.abs(x - 442) < 9 || Math.abs(x - 512) < 9 || Math.abs(x - 582) < 9) return rgb(INK);
    return rgb(WHITE); // gritted teeth
  }
  if (inRRect(x, y, 512, 680, 176, 64, 56)) return rgb(INK); // mouth outline
  // Fury flush: hotter toward the crown.
  return faceChip(x, y, (c, _fx, fy) => mix(c, FLUSH, 0.62 * Math.max(0, 1 - fy / 760))) ?? T;
}

function tease(x, y) {
  if (inCircle(x, y, 366, 440, 50)) return rgb(INK); // open eye
  if (inCapsule(x, y, 590, 440, 736, 440, 23)) return rgb(INK); // wink
  if (inEllipse(x, y, 596, 742, 82, 108)) {
    if (Math.abs(x - 596) < 10 && y > 700) return rgb(mix(TONGUE, INK, 0.35));
    return rgb(TONGUE); // tongue out
  }
  if (inCircle(x, y, 512, 590, 158) && y > 590) return rgb(INK); // grin
  return faceChip(x, y) ?? T;
}

function cheer(x, y) {
  if (inCircle(x, y, 512, 96, 60)) return rgb(RED); // pompom
  if (inTriangle(x, y, [512, 72], [316, 396], [708, 396])) {
    if (y > 330) return rgb(GOLD); // hat band
    return rgb(BLUE);
  }
  if (inCrescent(x, y, 366, 490, 70, false)) return rgb(INK);
  if (inCrescent(x, y, 658, 490, 70, false)) return rgb(INK);
  if (inCircle(x, y, 512, 640, 160) && y > 640) {
    if (y < 680) return rgb(WHITE);
    return rgb(INK);
  }
  return faceChip(x, y) ?? T;
}

function shock(x, y) {
  if (inCapsule(x, y, 300, 322, 428, 306, 20)) return rgb(INK); // raised brows
  if (inCapsule(x, y, 724, 322, 596, 306, 20)) return rgb(INK);
  if (inCircle(x, y, 366, 466, 88)) {
    if (inCircle(x, y, 366, 480, 38)) return rgb(INK);
    return rgb(WHITE);
  }
  if (inCircle(x, y, 658, 466, 88)) {
    if (inCircle(x, y, 658, 480, 38)) return rgb(INK);
    return rgb(WHITE);
  }
  if (inCircle(x, y, 512, 700, 74)) return rgb(INK); // o-mouth
  return faceChip(x, y) ?? T;
}

function thumbs(x, y) {
  // Golden thumbs-up on a slate chip.
  if (inRRect(x, y, 400, 610, 62, 138, 30)) return rgb(WHITE); // cuff
  if (inCapsule(x, y, 520, 520, 574, 330, 62)) return rgb(GOLD); // thumb
  if (inRRect(x, y, 592, 620, 148, 128, 58)) return rgb(GOLD); // fist
  if (inCapsule(x, y, 520, 540, 580, 350, 78) && inRRect(x, y, 596, 626, 168, 148, 62))
    return rgb(GOLD);
  return slateChip(x, y) ?? T;
}

function gg(x, y) {
  // Champion's crown on a slate chip — the "GG" salute.
  const bandTop = 600;
  if (inCircle(x, y, 352, 700, 30)) return rgb(RED); // gems
  if (inCircle(x, y, 512, 700, 30)) return rgb(GREEN);
  if (inCircle(x, y, 672, 700, 30)) return rgb(BLUE);
  if (inRRect(x, y, 512, 700, 220, 60, 24)) return rgb(GOLD);
  if (inTriangle(x, y, [302, bandTop + 40], [332, 360], [452, bandTop])) return rgb(GOLD);
  if (inTriangle(x, y, [452, bandTop + 40], [512, 300], [572, bandTop + 40])) return rgb(GOLD);
  if (inTriangle(x, y, [572, bandTop], [692, 360], [722, bandTop + 40])) return rgb(GOLD);
  if (inCircle(x, y, 332, 340, 34)) return rgb(GOLD_DARK); // peak tips
  if (inCircle(x, y, 512, 282, 34)) return rgb(GOLD_DARK);
  if (inCircle(x, y, 692, 340, 34)) return rgb(GOLD_DARK);
  return slateChip(x, y) ?? T;
}

// --- Renderer + PNG encoder (as gen-app-icon.mjs) ----------------------------
function render(out, sampler) {
  const SS = 3;
  const buf = Buffer.alloc(out * out * 4);
  const f = 1024 / out;
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let aw = 0;
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
      const idx = (y * out + x) * 4;
      const alpha = Math.round((aw / (SS * SS)) * 255);
      if (alpha < 1) continue;
      buf[idx] = Math.round(r / aw);
      buf[idx + 1] = Math.round(g / aw);
      buf[idx + 2] = Math.round(b / aw);
      buf[idx + 3] = alpha;
    }
  }
  return buf;
}

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
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// --- Emit --------------------------------------------------------------------
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "emoji");
mkdirSync(outDir, { recursive: true });

const SIZE = 128;
const EMOJIS = { laugh, cry, angry, tease, cheer, shock, thumbs, gg };
for (const [name, sampler] of Object.entries(EMOJIS)) {
  const png = encodePNG(SIZE, render(SIZE, sampler));
  writeFileSync(join(outDir, `${name}.png`), png);
  console.log(`Wrote emoji/${name}.png (${SIZE}x${SIZE}, ${png.length} bytes)`);
}
