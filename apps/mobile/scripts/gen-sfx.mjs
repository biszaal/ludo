/**
 * Generates the event sound effects (same PCM/WAV pattern as gen-hop-sound.mjs):
 *   capture.wav — descending swoop + pop (opponent sent home)
 *   finish.wav  — quick two-note ascending chime (pawn reaches the center)
 *   win.wav     — short four-note fanfare arpeggio
 *   tap.wav     — tiny soft click for button presses
 *   turn.wav    — muted wood-block tick on turn hand-off
 *   ding.wav    — warm bell: it's your turn (online)
 *   pop.wav     — bubbly up-blip: a reaction emoji arrived
 *   msg.wav     — soft two-tone: a chat message arrived
 * Run: node scripts/gen-sfx.mjs
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

function buffer(durationS) {
  return new Float64Array(Math.floor(SR * durationS));
}

/** Add a decaying tone (sine + soft octave) into `out` starting at `at` seconds. */
function tone(out, at, freq, amp, decay, durationS = 0.6) {
  const start = Math.floor(at * SR);
  const n = Math.min(out.length - start, Math.floor(durationS * SR));
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    phase += (2 * Math.PI * freq) / SR;
    const attack = Math.min(1, t / 0.005);
    const env = Math.exp(-t * decay) * attack;
    out[start + i] += (Math.sin(phase) + 0.2 * Math.sin(2 * phase)) * amp * env;
  }
}

// capture.wav — down-swept "swoop" then a low pop as the pawn lands in its yard.
{
  const out = buffer(0.32);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const freq = 760 * Math.pow(180 / 760, t / 0.26);
    phase += (2 * Math.PI * freq) / SR;
    const env = Math.exp(-t * 11) * Math.min(1, t / 0.004);
    out[i] += Math.sin(phase) * 0.5 * env;
  }
  tone(out, 0.2, 140, 0.55, 34, 0.12); // the pop
  writeWav("capture.wav", out);
}

// finish.wav — two quick ascending chime notes.
{
  const out = buffer(0.45);
  tone(out, 0.0, 660, 0.4, 14);
  tone(out, 0.09, 990, 0.42, 11);
  writeWav("finish.wav", out);
}

// win.wav — four-note fanfare (C5 E5 G5 C6) with a final sustained chord.
{
  const out = buffer(1.1);
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => tone(out, i * 0.11, f, 0.34, 9));
  tone(out, 0.44, 523.25, 0.22, 4);
  tone(out, 0.44, 783.99, 0.22, 4);
  tone(out, 0.44, 1046.5, 0.26, 4);
  writeWav("win.wav", out);
}

// tap.wav — tiny click, barely-there.
{
  const out = buffer(0.05);
  tone(out, 0, 1700, 0.22, 90, 0.05);
  writeWav("tap.wav", out);
}

// turn.wav — muted wood-block tick.
{
  const out = buffer(0.09);
  tone(out, 0, 950, 0.3, 55, 0.09);
  tone(out, 0, 460, 0.18, 45, 0.09);
  writeWav("turn.wav", out);
}

// ding.wav — warm two-partial bell.
{
  const out = buffer(0.6);
  tone(out, 0, 880, 0.34, 6);
  tone(out, 0, 1760, 0.12, 9);
  writeWav("ding.wav", out);
}

// pop.wav — bubbly rising blip (reaction emoji).
{
  const out = buffer(0.14);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const freq = 420 * Math.pow(1180 / 420, t / 0.12); // glide up
    phase += (2 * Math.PI * freq) / SR;
    const env = Math.exp(-t * 26) * Math.min(1, t / 0.004);
    out[i] += Math.sin(phase) * 0.42 * env;
  }
  writeWav("pop.wav", out);
}

// msg.wav — soft two-tone notification (chat message).
{
  const out = buffer(0.28);
  tone(out, 0, 620, 0.26, 22, 0.14);
  tone(out, 0.09, 830, 0.28, 18, 0.18);
  writeWav("msg.wav", out);
}
