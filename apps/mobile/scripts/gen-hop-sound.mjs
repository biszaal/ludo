/**
 * Generates assets/hop.wav — a short, cartoon "boing" used for each token hop.
 * Run: node scripts/gen-hop-sound.mjs
 *
 * A downward pitch glide (≈900→520 Hz) with a fast decay reads as a bouncy hop.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SR = 44100;
const DUR = 0.13; // seconds
const N = Math.floor(SR * DUR);

const data = Buffer.alloc(N * 2); // 16-bit mono
let phase = 0;
for (let n = 0; n < N; n++) {
  const t = n / SR;
  const freq = 900 * Math.pow(520 / 900, t / DUR); // glide down
  phase += (2 * Math.PI * freq) / SR;
  const attack = Math.min(1, t / 0.004);
  const env = Math.exp(-t * 24) * attack;
  const sample = (Math.sin(phase) + 0.18 * Math.sin(2 * phase)) * 0.5 * env;
  const int16 = Math.max(-1, Math.min(1, sample)) * 32767;
  data.writeInt16LE(int16 | 0, n * 2);
}

// WAV (RIFF) header for 16-bit PCM mono.
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16); // fmt chunk size
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // channels
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 2, 28); // byte rate
header.writeUInt16LE(2, 32); // block align
header.writeUInt16LE(16, 34); // bits per sample
header.write("data", 36);
header.writeUInt32LE(data.length, 40);

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "hop.wav");
writeFileSync(outPath, Buffer.concat([header, data]));
console.log(`Wrote ${outPath} (${header.length + data.length} bytes)`);
