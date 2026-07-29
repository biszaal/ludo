/**
 * Generates assets/dice.wav — a short dice-rattle for the roll animation.
 * Run: node scripts/gen-dice-sound.mjs
 *
 * A handful of fast-decaying noise "clacks" reads as dice tumbling in a cup.
 * Each clack is split into two layers of the same noise: a darker lowpassed
 * mid (the original clack) and a resonant ~420 Hz low band (the table thump)
 * — weight without tonal "knock" notes. Seeded PRNG keeps the file
 * reproducible.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SR = 44100;
const DUR = 0.36;
const N = Math.floor(SR * DUR);

// Deterministic RNG — regenerating the asset yields the identical file.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x1d1ce);

// [time(s), amplitude] of each clack.
const clacks = [
  [0.0, 0.9],
  [0.055, 0.7],
  [0.11, 0.85],
  [0.165, 0.6],
  [0.225, 0.8],
  [0.3, 0.55],
];

// Mid layer: one-pole lowpass ~2.2 kHz — the old clack, minus the hiss.
const lpCoef = Math.exp((-2 * Math.PI * 2200) / SR);
// Low layer: two-pole resonator at ~420 Hz over the same noise — the thump.
const lowF = 420;
const lowR = 0.96;
const c1 = 2 * lowR * Math.cos((2 * Math.PI * lowF) / SR);
const c2 = -lowR * lowR;

const buf = new Float64Array(N);
let lp = 0;
let y1 = 0;
let y2 = 0;
for (let n = 0; n < N; n++) {
  const t = n / SR;
  let s = 0;
  let sLow = 0;
  for (const [tc, amp] of clacks) {
    if (t >= tc) {
      const noise = rand() * 2 - 1;
      s += noise * amp * Math.exp(-(t - tc) * 75);
      // Low layer decays slower — the thump rings a touch past the clack.
      sLow += noise * amp * Math.exp(-(t - tc) * 45);
    }
  }
  lp = s + lpCoef * (lp - s);
  const low = c1 * y1 + c2 * y2 + sLow;
  y2 = y1;
  y1 = low;
  buf[n] = lp * 0.75 + low * 0.055;
}

// Normalize to a known peak, hotter than the old 0.5 for extra punch.
let peak = 0;
for (let n = 0; n < N; n++) peak = Math.max(peak, Math.abs(buf[n]));
const gain = peak > 0 ? 0.85 / peak : 0;

const data = Buffer.alloc(N * 2);
for (let n = 0; n < N; n++) {
  const int16 = Math.max(-1, Math.min(1, buf[n] * gain)) * 32767;
  data.writeInt16LE(int16 | 0, n * 2);
}

// WAV (RIFF) header for 16-bit PCM mono.
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "dice.wav");
writeFileSync(outPath, Buffer.concat([header, data]));
console.log(`Wrote ${outPath} (${header.length + data.length} bytes)`);
