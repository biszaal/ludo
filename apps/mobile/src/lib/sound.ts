/**
 * Sound layer. Effects round-robin small player pools so rapid overlapping
 * plays all sound; a separate looping player carries the ambient music. All
 * calls are best-effort — audio never blocks gameplay, and failures (e.g.
 * simulator quirks) are ignored. Effects respect settings.soundOn, music
 * respects settings.musicOn plus the app's foreground state.
 *
 * Both channels also carry a master level from settings (soundVolume /
 * musicVolume), which multiplies the per-sound mix below rather than replacing
 * it. Where that master is APPLIED is the thing to be careful about: never in
 * playSound. Writing `player.volume` is a `runOnMain` property write, i.e. the
 * same blocking hop across Android's main thread that the rest of this file is
 * organised around avoiding, and doing it per play would put one on the hot
 * path of every hop of every move. It is applied instead when the slider moves
 * (applySoundVolume, from the settings subscription) and when a player is
 * created, which between them cover every player that can ever sound.
 *
 * The one thing to know before editing playSound: expo-audio's `seekTo` and
 * `play()` are implemented with OPPOSITE threading on the two platforms, so
 * there is no single correct way to order them. On Android `play()` blocks the
 * JS thread on the main queue the seek was already dispatched onto, so the
 * rewind is free and waiting for it is the mistake; on iOS `play()` runs inline
 * while the seek does not, so the rewind arrives after its own play and NOT
 * waiting is the mistake. Both mistakes sound the same from the sofa. See
 * rewindLandsBeforePlay in lib/soundPool.
 *
 * The pool sizes are the Android half of the same story: the main thread is a
 * genuinely scarce resource there, and every player created here costs an
 * ExoPlayer pinned to `context.mainLooper`, a media3 `MediaSession` and a
 * status-polling coroutine on `Dispatchers.Main`. So the pools below are as
 * small as the sound needs, and SOUND_DEBUG logs every play on a real device.
 */

import { Platform } from "react-native";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { effectiveVolume, freshSlot, latencyFromTrial, leadFromLatencies, pickSlot, rewindLandsBeforePlay, type Slot } from "./soundPool";
import { setMeasuredSoundLead } from "./soundSync";
import { useSettings } from "../store/settingsStore";

export type SoundName =
  | "hop" | "dice" | "capture" | "finish" | "win" | "tap" | "turn" | "ding" | "pop" | "msg" | "safe"
  | "laugh" | "crying" | "angry" | "tease" | "cheer" | "shock" | "thumbs" | "gg";

/**
 * `ms` is the clip's real length, measured from the file. The pool uses it to
 * know which players have finished — asking the native player instead
 * (`.playing` / `.currentTime`) is a `runOnMain` property read, which blocks the
 * JS thread on the main thread to learn something we already know.
 *
 * `pool` is how many of a sound can overlap. Read it as a cost, not a safety
 * margin: the third hop player is a third ExoPlayer + MediaSession + main-loop
 * coroutine, all competing for the one thread every `play()` has to cross. Two
 * cover a 70ms clip even at Board's 70ms landing throttle — one sounding, one
 * resting — and pickSlot alternates them, so a rewind never lands on the hop
 * before it (see __tests__/soundPool). Nothing else in the game overlaps with
 * itself at all.
 */
const SPECS: Record<SoundName, { source: number; pool: number; volume: number; ms: number }> = {
  hop: { source: require("../../assets/audio/sfx/hop.wav"), pool: 2, volume: 0.5, ms: 56 },
  dice: { source: require("../../assets/audio/sfx/dice.wav"), pool: 1, volume: 0.6, ms: 360 },
  capture: { source: require("../../assets/audio/sfx/capture.wav"), pool: 1, volume: 0.55, ms: 320 },
  finish: { source: require("../../assets/audio/sfx/finish.wav"), pool: 1, volume: 0.5, ms: 450 },
  win: { source: require("../../assets/audio/sfx/win.wav"), pool: 1, volume: 0.6, ms: 1100 },
  tap: { source: require("../../assets/audio/sfx/tap.wav"), pool: 1, volume: 0.35, ms: 50 },
  turn: { source: require("../../assets/audio/sfx/turn.wav"), pool: 1, volume: 0.4, ms: 90 },
  ding: { source: require("../../assets/audio/sfx/ding.wav"), pool: 1, volume: 0.5, ms: 600 },
  pop: { source: require("../../assets/audio/sfx/pop.wav"), pool: 1, volume: 0.5, ms: 140 },
  msg: { source: require("../../assets/audio/sfx/msg.wav"), pool: 1, volume: 0.45, ms: 280 },
  safe: { source: require("../../assets/audio/sfx/safe.wav"), pool: 1, volume: 0.45, ms: 400 },
  // Reaction-emoji voices — one per sprite, so a reaction never borrows a UI
  // sound. These are recorded audio normalized by scripts/process-reaction-sfx.mjs
  // (sources in assets/source/raw-reactions/), not synthesis: a synthesized voice next
  // to the recorded laugh reads as obviously fake.
  laugh: { source: require("../../assets/audio/reactions/laugh.wav"), pool: 1, volume: 0.5, ms: 1360 },
  crying: { source: require("../../assets/audio/reactions/crying.wav"), pool: 1, volume: 0.5, ms: 1360 },
  angry: { source: require("../../assets/audio/reactions/angry.wav"), pool: 1, volume: 0.5, ms: 1360 },
  tease: { source: require("../../assets/audio/reactions/tease.wav"), pool: 1, volume: 0.5, ms: 1360 },
  cheer: { source: require("../../assets/audio/reactions/cheer.wav"), pool: 1, volume: 0.5, ms: 1360 },
  shock: { source: require("../../assets/audio/reactions/shock.wav"), pool: 1, volume: 0.5, ms: 1360 },
  thumbs: { source: require("../../assets/audio/reactions/thumbs.wav"), pool: 1, volume: 0.5, ms: 140 },
  gg: { source: require("../../assets/audio/reactions/gg.wav"), pool: 1, volume: 0.5, ms: 1000 },
};

/**
 * How often each player reports its status back to JS.
 *
 * expo-audio defaults to 500ms, and every player runs its own coroutine on
 * `Dispatchers.Main` to do it (BaseAudioPlayer.startUpdating). Nothing here
 * reads a status — the pool tracks clip lengths itself — so the loop is pure
 * main-thread noise on the one thread `play()` has to get through. A minute is
 * as close to "never" as the API allows.
 */
const STATUS_INTERVAL_MS = 60_000;

/** Music's own level in the mix, before the player's master is applied. The
 *  ambient loop sits well under the effects on purpose — it is a room, not an
 *  event. */
const MUSIC_BASE_VOLUME = 0.25;

const pools = {} as Record<SoundName, AudioPlayer[]>;
/** What JS believes each pooled player is doing. See lib/soundPool. */
const slots = {} as Record<SoundName, Slot[]>;
let ready = false;

/**
 * Diagnostics for the Android silence, off in store builds.
 *
 * Set `EXPO_PUBLIC_SOUND_DEBUG=1` for a build that logs every play and every
 * native status/error for the pooled players. The three things it is there to
 * separate, if slimming the pools was not enough:
 *
 *   - a play that JS issued but that never became `playing: true` natively
 *     (main-thread starvation, or an audio sink that failed to initialise);
 *   - a play that never happened because `ready` was false or the store said no;
 *   - a play that sounded but far later than the animation it belonged to
 *     (`lag` on the log line is how long `play()` blocked the JS thread, which
 *     is the length of the main-thread queue in front of it).
 */
const SOUND_DEBUG = process.env.EXPO_PUBLIC_SOUND_DEBUG === "1";

/** Per-sound play counter, so a log line says which hop of a burst it is. */
const plays = {} as Record<SoundName, number>;

function debugLog(line: string): void {
  // eslint-disable-next-line no-console
  console.log(`[sfx] ${line}`);
}

let music: AudioPlayer | null = null;
let appActive = true;

// createAudioPlayer players are never auto-released (expo-audio docs), and a
// dev reload re-evaluates this module while the previous generation's players
// live on natively — the old music loop then plays UNDER the new one. Each
// generation parks a release-everything handle on globalThis so the next one
// can silence it before creating its own players.
declare global {
  // eslint-disable-next-line no-var
  var __ludoSoundReset: (() => void) | undefined;
}

function releaseAll(): void {
  for (const name of Object.keys(pools) as SoundName[]) delete slots[name];
  // `remove()`, not `release()`. There is no `release` on an AudioPlayer — the
  // old call threw on every dev reload and was swallowed by the catch, so the
  // previous generation's players lived on and its music loop played UNDER the
  // new one, which is the exact thing this function exists to prevent.
  for (const pool of Object.values(pools)) {
    for (const p of pool) {
      try {
        p.remove();
      } catch {
        // already removed or context torn down
      }
    }
  }
  try {
    music?.remove();
  } catch {
    // ignore
  }
  music = null;
}

/** Create one sound's player pool. Idempotent — a pool that already exists is
 *  left exactly as it is, so warming twice costs nothing. */
function buildPool(name: SoundName): void {
  if (pools[name]) return;
  const spec = SPECS[name];
  slots[name] = Array.from({ length: spec.pool }, freshSlot);
  pools[name] = Array.from({ length: spec.pool }, (_, i) => {
    const player = createAudioPlayer(spec.source, { updateInterval: STATUS_INTERVAL_MS });
    // The master at creation time, not 1 — the deferred reaction voices are
    // built long after the slider was last moved, and a pool born at full
    // volume would be the one set of sounds that ignored it.
    player.volume = effectiveVolume(spec.volume, useSettings.getState().soundVolume);
    // Only under the debug flag: a status listener is a native→JS event per
    // change, over the same main thread the sound has to cross, so a shipped
    // build must not pay for one.
    if (SOUND_DEBUG) {
      try {
        player.addListener("playbackStatusUpdate", (st) => {
          if (!st.playing && !st.didJustFinish && st.isLoaded) return;
          debugLog(
            `native ${name}#${i} playing=${st.playing} finished=${st.didJustFinish}` +
              ` loaded=${st.isLoaded} state=${st.playbackState} waiting=${st.reasonForWaitingToPlay}`,
          );
        });
      } catch (err) {
        debugLog(`listen ${name}#${i} FAILED ${String(err)}`);
      }
    }
    return player;
  });
  if (SOUND_DEBUG) debugLog(`built ${name} x${spec.pool} (${countPlayers()} players total)`);
}

/**
 * Push the effects master onto every player that exists.
 *
 * Called when the slider moves, and only then — see the header for why this is
 * not done per play. Walking the whole pool set is a handful of native writes
 * at a moment when nothing is animating, which is the cheapest time to spend
 * the main thread.
 */
function applySoundVolume(): void {
  const master = useSettings.getState().soundVolume;
  for (const [name, pool] of Object.entries(pools) as [SoundName, AudioPlayer[]][]) {
    for (const player of pool) {
      try {
        player.volume = effectiveVolume(SPECS[name].volume, master);
      } catch {
        // player removed underneath us — a dev reload, or releaseAll
      }
    }
  }
}

/** Native players currently alive, music included — the number that matters if
 *  Android's per-app audio track limit is what is eating the sound. */
function countPlayers(): number {
  let n = music ? 1 : 0;
  for (const pool of Object.values(pools)) n += pool.length;
  return n;
}

/**
 * Reaction voices, held back from launch.
 *
 * These eight are ~255KB each — about 2MB of the app's 2.6MB audio budget — and
 * they are only ever needed if someone opens the reaction bar in an online
 * match. Creating them up front meant every cold start paid for eight native
 * players most sessions never use. They are built when the reaction bar first
 * appears (warmReactionSounds), which is comfortably before anyone can tap one.
 */
const DEFERRED: ReadonlySet<SoundName> = new Set<SoundName>([
  "laugh",
  "crying",
  "angry",
  "tease",
  "cheer",
  "shock",
  "thumbs",
  "gg",
]);

/**
 * Build the reaction voices. Called when the reaction bar mounts, which is the
 * last moment that is still comfortably ahead of anyone tapping one — creating
 * a player at tap time would swallow the first reaction while it loads.
 */
export function warmReactionSounds(): void {
  if (!ready) return;
  try {
    for (const name of DEFERRED) buildPool(name);
  } catch {
    // A reaction that cannot load is silent, not fatal.
  }
}

/** True once THIS module generation has begun init — set synchronously so a
 *  second call can never slip past while the first is still awaiting. */
let initStarted = false;

/** Load all sounds, start music (if enabled) and allow playback in silent mode. */
export async function initSound(): Promise<void> {
  if (initStarted) return;
  initStarted = true;
  try {
    globalThis.__ludoSoundReset?.();
  } catch {
    // ignore
  }
  globalThis.__ludoSoundReset = releaseAll;
  try {
    await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: "mixWithOthers", shouldPlayInBackground: false });
  } catch {
    // non-fatal
  }
  try {
    for (const name of Object.keys(SPECS) as SoundName[]) {
      if (DEFERRED.has(name)) continue;
      buildPool(name);
    }
    music = createAudioPlayer(require("../../assets/audio/music/music.wav"), {
      updateInterval: STATUS_INTERVAL_MS,
    });
    music.loop = true;
    music.volume = effectiveVolume(MUSIC_BASE_VOLUME, useSettings.getState().musicVolume);
    ready = true;
  } catch (err) {
    ready = false;
    if (SOUND_DEBUG) debugLog(`init FAILED ${String(err)}`);
  }
  if (SOUND_DEBUG) debugLog(`init ready=${ready} players=${countPlayers()}`);
  // React to the music toggle and to both masters; effects check soundOn per
  // play but NOT their master, which is baked into each player's volume by the
  // branch below.
  //
  // The per-field guards are the whole selector: an unguarded subscribe would
  // run this on EVERY settings write, including setBoardTheme, and each run
  // costs native property writes across every player alive. (A real selector
  // would need the subscribeWithSelector middleware on the store — not worth
  // adding for three fields.)
  const initial = useSettings.getState();
  let lastMusicOn = initial.musicOn;
  let lastMusicVolume = initial.musicVolume;
  let lastSoundVolume = initial.soundVolume;
  useSettings.subscribe((st) => {
    if (st.soundVolume !== lastSoundVolume) {
      lastSoundVolume = st.soundVolume;
      applySoundVolume();
    }
    if (st.musicOn !== lastMusicOn || st.musicVolume !== lastMusicVolume) {
      lastMusicOn = st.musicOn;
      lastMusicVolume = st.musicVolume;
      syncMusic();
    }
  });
  syncMusic();
  // Once the launch has settled — nothing is hopping yet, and calibrating
  // during startup would compete with it for the main thread.
  setTimeout(() => void calibrateLead(), CALIBRATION_DELAY_MS);
}

/** Trials per measurement; the median of three shrugs off one bad one. */
const CALIBRATION_TRIALS = 3;
/**
 * When to read the player's position after starting it. Late enough for its
 * clock to have locked onto the audio output (which it only does once the
 * output reports real timestamps), early enough to still be inside the clip.
 */
const CALIBRATION_READ_MS = 600;
const CALIBRATION_DELAY_MS = 1500;
let calibrating = false;

/**
 * Measure this phone's sound delay, and publish it for the timing code
 * (lib/soundSync) — moveTiming's fixed SFX_LEAD_MS can be right on one kind of
 * phone at most: the delay is ~200ms on a Galaxy S26 Ultra, whose media audio
 * goes through a deep buffer, and a fraction of that on most phones.
 *
 * How: play a clip SILENTLY, through the very same kind of player and the same
 * start-up as a real effect, wait, and read how far the player says it has
 * got. The player's position is what has been heard —
 * both platforms keep it on the output's clock, which is how video stays in
 * step with its sound — so the gap between asking and the start of what has
 * been heard is the delay (soundPool.latencyFromTrial).
 *
 * Run a moment after launch and again whenever the app comes back to the front,
 * because the delay moves with the output: plugging in headphones or connecting
 * Bluetooth changes it by hundreds of milliseconds.
 */
async function calibrateLead(): Promise<void> {
  if (calibrating || !ready) return;
  calibrating = true;
  let player: AudioPlayer | null = null;
  try {
    // The win fanfare: 1.1s, so it is still playing when it is read.
    player = createAudioPlayer(SPECS.win.source, { updateInterval: STATUS_INTERVAL_MS });
    player.volume = 0;
    for (let waited = 0; !player.isLoaded && waited < 2000; waited += 50) await sleep(50);
    const latencies: number[] = [];
    for (let i = 0; i < CALIBRATION_TRIALS; i++) {
      const ms = await calibrationTrial(player);
      if (ms !== null) latencies.push(ms);
    }
    const lead = leadFromLatencies(latencies);
    // A failed measurement keeps whatever was known before it.
    if (lead !== null) setMeasuredSoundLead(lead);
    if (SOUND_DEBUG) debugLog(`calibrated lead=${lead}ms from [${latencies.map(Math.round).join(", ")}]`);
  } catch (err) {
    if (SOUND_DEBUG) debugLog(`calibration FAILED ${String(err)}`);
  } finally {
    try {
      player?.remove();
    } catch {
      // already gone
    }
    calibrating = false;
  }
}

/** One silent play, started exactly the way playSound starts an effect. */
async function calibrationTrial(player: AudioPlayer): Promise<number | null> {
  const askedAt = Date.now();
  if (rewindLandsBeforePlay(Platform.OS)) {
    void player.seekTo(0).catch(() => {});
    player.play();
  } else {
    await player.seekTo(0).catch(() => {});
    player.play();
  }
  await sleep(CALIBRATION_READ_MS);
  const before = Date.now();
  const position = player.currentTime;
  // The read crosses to the native player and back; take the middle of it.
  const readAt = (before + Date.now()) / 2;
  player.pause();
  await sleep(100);
  return position > 0 ? latencyFromTrial(askedAt, readAt, position) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Play a one-shot effect (no-op when sound is off or audio failed to load). */
export function playSound(name: SoundName): void {
  // One store read, reused — `getState()` twice on the hot path for the sake
  // of a log line is a cost every hop pays so that a disabled branch can be
  // tidier. A master of 0 short-circuits here rather than starting a silent
  // clip: the play would cross the main thread to produce nothing.
  const settings = useSettings.getState();
  if (!ready || !settings.soundOn || settings.soundVolume === 0) {
    if (SOUND_DEBUG) {
      debugLog(`skip ${name} ready=${ready} soundOn=${settings.soundOn} master=${settings.soundVolume}`);
    }
    return;
  }
  if (!pools[name] && DEFERRED.has(name)) buildPool(name);
  const pool = pools[name];
  const mine = slots[name];
  if (!pool || pool.length === 0 || !mine) {
    if (SOUND_DEBUG) debugLog(`skip ${name} no pool`);
    return;
  }

  const now = Date.now();
  const index = pickSlot(mine);
  const player = pool[index]!;
  mine[index]!.busyUntil = now + SPECS[name].ms;
  try {
    // Seek unconditionally. All three states a pooled player can be in want a
    // rewind: one that has finished is parked at the END of its clip and will
    // play nothing without it; a never-played one is already at 0, so the seek
    // is free; and one stolen mid-clip is meant to restart.
    //
    // WHETHER TO WAIT FOR IT is a per-platform answer, and getting it wrong in
    // either direction is a silence — see rewindLandsBeforePlay. On Android the
    // play already blocks on the queue the seek was put on, so waiting only
    // adds a JS round trip across a saturated main thread. On iOS the play runs
    // inline and the seek does not, so a fired-and-forgotten seek lands after
    // its own play and the sound is lost.
    if (rewindLandsBeforePlay(Platform.OS)) {
      void player.seekTo(0).catch(() => {});
      player.play();
    } else {
      // A rewind that failed is not a reason to stay silent, so the play is
      // chained past the failure rather than off the success.
      void player
        .seekTo(0)
        .catch(() => {})
        .then(() => player.play())
        .catch((err: unknown) => {
          // Player removed underneath us — a dev reload, or releaseAll.
          if (SOUND_DEBUG) debugLog(`play ${name}#${index} LATE THREW ${String(err)}`);
        });
    }
  } catch (err) {
    if (SOUND_DEBUG) debugLog(`play ${name}#${index} THREW ${String(err)}`);
    return;
  }
  if (SOUND_DEBUG) {
    plays[name] = (plays[name] ?? 0) + 1;
    // `lag` is how long play() blocked the JS thread waiting for the Android
    // main queue — i.e. how far behind the main thread was at that instant.
    debugLog(`play ${name}#${index} n=${plays[name]} lag=${Date.now() - now}ms`);
  }
}

/** A single hop "boing" — call once per cell a token steps through. */
export const playHop = (): void => playSound("hop");

/** The dice rattle — call when a roll begins. */
export const playDiceRoll = (): void => playSound("dice");

/** Called from the AppState listener: pause music in background, resume in front. */
export function setMusicActive(active: boolean): void {
  const wasActive = appActive;
  appActive = active;
  syncMusic();
  // Back in front: headphones or Bluetooth may have come or gone while away,
  // and the sound delay with them. Measure again.
  if (active && !wasActive) setTimeout(() => void calibrateLead(), CALIBRATION_DELAY_MS);
}

function syncMusic(): void {
  if (!music) return;
  const st = useSettings.getState();
  try {
    // Level first, so a drag while the loop is already playing is heard as it
    // happens rather than at the next pause/resume.
    music.volume = effectiveVolume(MUSIC_BASE_VOLUME, st.musicVolume);
    if (st.musicOn && appActive) {
      if (!music.playing) music.play();
    } else if (music.playing) {
      music.pause();
    }
  } catch {
    // ignore
  }
}
