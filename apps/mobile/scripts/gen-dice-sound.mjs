/**
 * Generates assets/dice.wav — a short dice-rattle for the roll animation.
 * Run: node scripts/gen-dice-sound.mjs
 *
 * A handful of fast-decaying noise "clacks" reads as dice tumbling in a cup.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SR = 44100;
const DUR = 0.36;
const N = Math.floor(SR * DUR);

// [time(s), amplitude] of each clack.
const clacks = [
  [0.0, 0.9],
  [0.055, 0.7],
  [0.11, 0.85],
  [0.165, 0.6],
  [0.225, 0.8],
  [0.3, 0.55],
];

const data = Buffer.alloc(N * 2);
let prev = 0;
for (let n = 0; n < N; n++) {
  const t = n / SR;
  let s = 0;
  for (const [tc, amp] of clacks) {
    if (t >= tc) s += (Math.random() * 2 - 1) * amp * Math.exp(-(t - tc) * 75);
  }
  // Light low-pass (2-sample average) to soften the harshest hiss.
  const filtered = (s + prev) * 0.5;
  prev = s;
  const int16 = Math.max(-1, Math.min(1, filtered * 0.5)) * 32767;
  data.writeInt16LE(int16 | 0, n * 2);
}

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
