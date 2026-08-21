/**
 * Normalizes sourced reaction-emoji recordings into the app's sound assets.
 *
 * Reaction voices are recorded audio, not synthesis: drop a source file (any
 * format ffmpeg reads) into assets/raw-reactions/<name>.<ext> and run this to
 * produce assets/<name>.wav in the exact shape the sound layer expects — mono,
 * 44.1 kHz, 16-bit PCM, trimmed, faded, and level-matched to the other
 * reactions so none of them jumps out over the game.
 *
 * A name with no file in raw-reactions/ is skipped, never overwritten. That is
 * what protects laugh.wav: it was dropped in as a finished asset and has no raw
 * source here, so running this can only leave it alone.
 *
 * Requires ffmpeg on PATH. Provenance lives in assets/REACTION-SOUNDS.md.
 * Run: node scripts/process-reaction-sfx.mjs [name ...]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = join(ROOT, "assets", "raw-reactions");
const OUT_DIR = join(ROOT, "assets");

/**
 * Match average level, not peak. Reactions differ wildly in crest factor — a
 * sustained laugh and a burst of applause peaking at the same dBFS are nowhere
 * near equally loud — so normalize RMS and cap peaks with a limiter instead.
 * -16 dB is laugh.wav's measured mean, and laugh.wav is the reference.
 */
const TARGET_RMS_DB = -16.0;

/** Peak ceiling the limiter enforces after the RMS gain is applied. */
const PEAK_CEILING_DB = -1.0;

/**
 * Per-sound trim. `dur` is the budget in seconds — these fire mid-game over the
 * dice and hop sounds, so they stay short; laugh.wav is 0.83s. `offset` seeks
 * into the source when the good part is not at the front (applause takes over a
 * second to reach full density). Leading silence is trimmed after the offset,
 * so a vocalization still keeps its onset.
 */
const CLIPS = {
  crying: { dur: 1.0 },
  angry: { dur: 0.7 },
  tease: { dur: 0.9 },
  cheer: { dur: 1.0 },
  shock: { dur: 0.6 },
  thumbs: { dur: 0.6 },
  gg: { dur: 1.0, offset: 1.3 },
  laugh: { dur: 0.9 },
};

function ffmpeg(args) {
  execFileSync("ffmpeg", ["-y", "-v", "error", ...args], { stdio: ["ignore", "pipe", "pipe"] });
}

/** Measured { peak, rms } of a file, in dBFS. (volumedetect reports on stderr.) */
function levels(file) {
  const run = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-i", file, "-af", "volumedetect", "-f", "null", "/dev/null"],
    { encoding: "utf8" },
  );
  const err = run.stderr ?? "";
  const peak = /max_volume:\s*(-?[\d.]+) dB/.exec(err);
  const rms = /mean_volume:\s*(-?[\d.]+) dB/.exec(err);
  if (!peak || !rms) throw new Error(`could not measure ${file}`);
  return { peak: Number(peak[1]), rms: Number(rms[1]) };
}

function findRaw(name) {
  if (!existsSync(RAW_DIR)) return null;
  const hit = readdirSync(RAW_DIR).find((f) => f.replace(/\.[^.]+$/, "") === name);
  return hit ? join(RAW_DIR, hit) : null;
}

const only = process.argv.slice(2);
const names = only.length > 0 ? only : Object.keys(CLIPS);
let wrote = 0;

for (const name of names) {
  const clip = CLIPS[name];
  if (clip === undefined) {
    console.error(`Unknown reaction "${name}" — expected one of ${Object.keys(CLIPS).join(", ")}`);
    process.exitCode = 1;
    continue;
  }
  const raw = findRaw(name);
  if (!raw) {
    console.log(`skip ${name} (no assets/raw-reactions/${name}.*)`);
    continue;
  }

  // Pass 1: shape it — seek past any dead intro, trim remaining leading
  // silence, cut to length, fade the tail so a hard cut never clicks, and
  // force the app's mono/44.1k/16-bit format.
  const { dur, offset = 0 } = clip;
  const fade = Math.min(0.12, dur * 0.15);
  const staged = join(OUT_DIR, `.${name}.stage.wav`);
  ffmpeg([
    ...(offset > 0 ? ["-ss", String(offset)] : []),
    "-i", raw,
    "-af",
    [
      "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02",
      `atrim=0:${dur}`,
      `afade=t=out:st=${(dur - fade).toFixed(3)}:d=${fade.toFixed(3)}`,
      "aformat=sample_fmts=s16:sample_rates=44100:channel_layouts=mono",
    ].join(","),
    staged,
  ]);

  // Pass 2: normalize. Measuring then applying a flat gain is deterministic —
  // loudnorm's single-pass analysis is unreliable on clips this short. The
  // limiter then holds peaks down without disturbing the average just set.
  const gain = TARGET_RMS_DB - levels(staged).rms;
  const ceiling = Math.pow(10, PEAK_CEILING_DB / 20).toFixed(4);
  ffmpeg([
    "-i", staged,
    "-af", `volume=${gain.toFixed(2)}dB,alimiter=limit=${ceiling}:level=disabled`,
    join(OUT_DIR, `${name}.wav`),
  ]);
  rmSync(staged, { force: true });

  const out = levels(join(OUT_DIR, `${name}.wav`));
  console.log(
    `wrote ${name}.wav  ${dur}s${offset ? ` @${offset}s` : ""}  ` +
      `gain ${gain >= 0 ? "+" : ""}${gain.toFixed(1)}dB  ` +
      `rms ${out.rms.toFixed(1)}dB  peak ${out.peak.toFixed(1)}dB`,
  );
  wrote += 1;
}

if (wrote === 0) {
  mkdirSync(RAW_DIR, { recursive: true });
  console.log(`\nNothing to do. Drop sources in ${RAW_DIR} named <reaction>.<ext>.`);
}
