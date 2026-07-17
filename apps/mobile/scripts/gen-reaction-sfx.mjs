/**
 * Generates the reaction-emoji sounds (same PCM/WAV pattern as gen-sfx.mjs) —
 * cartoonish synthesized vocalizations, kept in the app's procedural soundscape
 * rather than recorded voices:
 *   laugh.wav — four staccato descending "ha" blips with vibrato
 *   crying.wav — two long "wah" sine droops
 *   angry.wav — low sawtooth growl with tremolo
 *   tease.wav — nasal rising-falling "nyah" glide, twice
 *   cheer.wav — fast major arpeggio + noise sparkle
 *   shock.wav — quick spring "boing"
 * (thumbs reuses pop.wav, gg reuses finish.wav — see src/lib/emoji.ts)
 * Run: node scripts/gen-reaction-sfx.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SR = 44100;

function writeWav(name, samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let n = 0; n < samples.length; n++) {
    const s = Math.max(-1, Math.min(1, samples[n]));
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
  const outPath = join(outDir, name);
  writeFileSync(outPath, Buffer.concat([header, data]));
  console.log(`Wrote ${outPath} (${header.length + data.length} bytes)`);
}

const buffer = (durationS) => new Float64Array(Math.floor(SR * durationS));

/** Add a glided, vibrato'd voice-ish tone (sine + soft square harmonics). */
function voice(out, at, f0, f1, durS, amp, { vibHz = 0, vibAmt = 0, nasal = 0.2, attack = 0.01, release = 6 } = {}) {
  const start = Math.floor(at * SR);
  const n = Math.min(out.length - start, Math.floor(durS * SR));
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const k = t / durS;
    let freq = f0 * Math.pow(f1 / f0, k);
    if (vibHz) freq *= 1 + vibAmt * Math.sin(2 * Math.PI * vibHz * t);
    phase += (2 * Math.PI * freq) / SR;
    const env = Math.min(1, t / attack) * Math.exp(-Math.max(0, t - durS * 0.6) * release) * Math.sin(Math.PI * Math.min(1, k * 1.05));
    const s = Math.sin(phase) + nasal * Math.sin(2 * phase) + nasal * 0.4 * Math.sin(3 * phase);
    out[start + i] += s * amp * env;
  }
}

// laugh.wav — "ha-ha-ha-ha": staccato blips stepping down, each with a tiny droop.
{
  const out = buffer(0.72);
  const steps = [520, 470, 430, 390];
  steps.forEach((f, i) => {
    voice(out, i * 0.16, f * 1.12, f * 0.86, 0.11, 0.42, { vibHz: 26, vibAmt: 0.02, nasal: 0.3, attack: 0.006 });
  });
  writeWav("laugh.wav", out);
}

// crying.wav — two long "wah" droops with heavy vibrato (a cartoon sob).
{
  const out = buffer(0.95);
  voice(out, 0.0, 640, 300, 0.42, 0.4, { vibHz: 7, vibAmt: 0.05, nasal: 0.25, attack: 0.03, release: 4 });
  voice(out, 0.48, 560, 250, 0.44, 0.36, { vibHz: 7, vibAmt: 0.06, nasal: 0.25, attack: 0.03, release: 4 });
  writeWav("crying.wav", out);
}

// angry.wav — low sawtooth growl, tremolo'd, with a bark at the front.
{
  const out = buffer(0.5);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const freq = 130 - 30 * (t / 0.5);
    phase += freq / SR;
    const saw = 2 * (phase - Math.floor(phase + 0.5)); // sawtooth
    const trem = 0.72 + 0.28 * Math.sin(2 * Math.PI * 19 * t);
    const env = Math.min(1, t / 0.015) * Math.exp(-t * 5.5);
    out[i] += saw * 0.38 * trem * env;
  }
  voice(out, 0, 220, 130, 0.12, 0.3, { nasal: 0.5, attack: 0.004 });
  writeWav("angry.wav", out);
}

// tease.wav — sing-song "nyah nyah": up-down glide, then again a third lower.
{
  const out = buffer(0.7);
  voice(out, 0.0, 420, 560, 0.16, 0.34, { nasal: 0.55, attack: 0.01 });
  voice(out, 0.17, 560, 420, 0.15, 0.34, { nasal: 0.55, attack: 0.01 });
  voice(out, 0.38, 350, 470, 0.14, 0.3, { nasal: 0.55, attack: 0.01 });
  voice(out, 0.53, 470, 330, 0.15, 0.3, { nasal: 0.55, attack: 0.01 });
  writeWav("tease.wav", out);
}

// cheer.wav — quick rising major arpeggio + a fizz of noise sparkle on top.
{
  const out = buffer(0.7);
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((f, i) => {
    voice(out, i * 0.09, f, f, 0.22, 0.3, { nasal: 0.15, attack: 0.005, release: 8 });
  });
  let sparkle = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    sparkle = 0.985 * sparkle + 0.015 * (Math.random() * 2 - 1);
    const env = t < 0.5 ? Math.sin(Math.PI * (t / 0.5)) : 0;
    out[i] += sparkle * 1.4 * env * 0.35;
  }
  writeWav("cheer.wav", out);
}

// shock.wav — a spring "boing": fast pitch drop that rebounds and wobbles out.
{
  const out = buffer(0.55);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const wob = Math.exp(-t * 6) * Math.sin(2 * Math.PI * 13 * t);
    const freq = 300 + 340 * Math.exp(-t * 14) + 120 * wob;
    phase += (2 * Math.PI * freq) / SR;
    const env = Math.min(1, t / 0.006) * Math.exp(-t * 6.5);
    out[i] += (Math.sin(phase) + 0.25 * Math.sin(2 * phase)) * 0.42 * env;
  }
  writeWav("shock.wav", out);
}
