/**
 * Generates assets/music.wav — a 16-second seamless ambient loop for the table.
 * Run: node scripts/gen-music.mjs
 *
 * A soft marimba-like arpeggio over two chords (Am7 → Fmaj7) above a quiet
 * root drone. Note tails wrap around the buffer end (modulo write), so the
 * loop point is genuinely seamless. Deterministic (seeded LCG), 22.05 kHz mono,
 * mixed low — it sits under the game, never on top of it.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SR = 22050;
const DUR = 16; // seconds — 8 bars at 120bpm
const N = SR * DUR;
const out = new Float64Array(N);

// Seeded LCG so the file is reproducible.
let seed = 20260705;
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
}

/** Add a marimba-ish note; the tail wraps modulo N for a seamless loop. */
function note(atS, freq, amp, decay = 3.2, durS = 2.4) {
  const start = Math.floor(atS * SR);
  const n = Math.floor(durS * SR);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    phase += (2 * Math.PI * freq) / SR;
    const attack = Math.min(1, t / 0.01);
    const env = Math.exp(-t * decay) * attack;
    const s = (Math.sin(phase) + 0.25 * Math.sin(3 * phase) * Math.exp(-t * 8)) * amp * env;
    out[(start + i) % N] += s;
  }
}

// Chord tones (Hz): Am7 = A3 C4 E4 G4, Fmaj7 = F3 A3 C4 E4.
const AM7 = [220.0, 261.63, 329.63, 392.0];
const FMAJ7 = [174.61, 220.0, 261.63, 329.63];

// Drones: chord roots one octave down, swelling gently, also wrapped.
function drone(atS, freq, durS) {
  const start = Math.floor(atS * SR);
  const n = Math.floor(durS * SR);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    phase += (2 * Math.PI * freq) / SR;
    const swell = Math.sin((Math.PI * i) / n); // rises and falls across the chord
    out[(start + i) % N] += Math.sin(phase) * 0.045 * swell;
  }
}
drone(0, 110.0, 8); // A2 under Am7
drone(8, 87.31, 8); // F2 under Fmaj7

// Arpeggio: one note per 8th (0.25s), skipping some beats for air.
const STEP = 0.25;
for (let step = 0; step < DUR / STEP; step++) {
  const t = step * STEP;
  const chord = t < 8 ? AM7 : FMAJ7;
  if (rand() < 0.3) continue; // rest ~30% of steps
  const tone = chord[Math.floor(rand() * chord.length)];
  const octave = rand() < 0.22 ? 2 : 1; // occasional sparkle an octave up
  const amp = 0.05 + rand() * 0.035;
  note(t, tone * octave, amp);
}

// Normalize to a low peak — background music, not foreground.
let peak = 0;
for (const s of out) peak = Math.max(peak, Math.abs(s));
const gain = 0.32 / peak;

const data = Buffer.alloc(N * 2);
for (let n = 0; n < N; n++) {
  const s = Math.max(-1, Math.min(1, out[n] * gain));
  data.writeInt16LE((s * 32767) | 0, n * 2);
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
const outPath = join(outDir, "music.wav");
writeFileSync(outPath, Buffer.concat([header, data]));
console.log(`Wrote ${outPath} (${header.length + data.length} bytes)`);
