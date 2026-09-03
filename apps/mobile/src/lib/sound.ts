/**
 * Sound layer. Effects round-robin small player pools so rapid overlapping
 * plays all sound; a separate looping player carries the ambient music. All
 * calls are best-effort — audio never blocks gameplay, and failures (e.g.
 * simulator quirks) are ignored. Effects respect settings.soundOn, music
 * respects settings.musicOn plus the app's foreground state.
 *
 * On the Android silence this file has been through three rounds of: see
 * lib/soundPool for what the earlier fixes got wrong about expo-audio's
 * threading. The short version is that `play()` blocks the JS thread on the
 * Android main queue rather than posting to it, so ordering was never in
 * danger — but the main thread is a genuinely scarce resource, and every player
 * created here costs an ExoPlayer pinned to `context.mainLooper`, a media3
 * `MediaSession` and a status-polling coroutine on `Dispatchers.Main`. So the
 * pools below are as small as the sound needs, and SOUND_DEBUG exists to settle
 * on a real device whether that was the whole story.
 */

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { freshSlot, pickSlot, type Slot } from "./soundPool";
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
 * margin: the fourth hop player is a fourth ExoPlayer + MediaSession + main-loop
 * coroutine, all competing for the one thread every `play()` has to cross. Three
 * covers a 130ms clip even at Board's 70ms landing throttle (see
 * __tests__/soundPool), and nothing else in the game overlaps with itself at
 * all.
 */
const SPECS: Record<SoundName, { source: number; pool: number; volume: number; ms: number }> = {
  hop: { source: require("../../assets/audio/sfx/hop.wav"), pool: 3, volume: 0.5, ms: 130 },
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
    player.volume = spec.volume;
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
    music.volume = 0.25;
    ready = true;
  } catch (err) {
    ready = false;
    if (SOUND_DEBUG) debugLog(`init FAILED ${String(err)}`);
  }
  if (SOUND_DEBUG) debugLog(`init ready=${ready} players=${countPlayers()}`);
  // React to the music toggle; effects check soundOn per play.
  //
  // syncMusic reads musicOn and nothing else, so the guard below is the whole
  // selector: an unguarded subscribe ran it on EVERY settings write, including
  // setBoardTheme. (A real selector would need the subscribeWithSelector
  // middleware on the store — not worth adding for one field.)
  let lastMusicOn = useSettings.getState().musicOn;
  useSettings.subscribe((st) => {
    if (st.musicOn === lastMusicOn) return;
    lastMusicOn = st.musicOn;
    syncMusic();
  });
  syncMusic();
}

/** Play a one-shot effect (no-op when sound is off or audio failed to load). */
export function playSound(name: SoundName): void {
  if (!ready || !useSettings.getState().soundOn) {
    if (SOUND_DEBUG) debugLog(`skip ${name} ready=${ready} soundOn=${useSettings.getState().soundOn}`);
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
  const index = pickSlot(mine, now);
  const player = pool[index]!;
  mine[index]!.busyUntil = now + SPECS[name].ms;
  try {
    // Seek unconditionally, and never await it. All three states a pooled
    // player can be in want a rewind: a finished ExoPlayer still holds
    // `playWhenReady`, so the seek alone restarts it; a never-played one is
    // already at 0, so it costs nothing; and one stolen mid-clip is meant to
    // restart. The play below cannot overtake it — `play()` is
    // `runBlocking(mainQueue)` and the seek was dispatched onto that same queue
    // first (see lib/soundPool), so the seek has already run by the time play
    // returns.
    void player.seekTo(0).catch(() => {});
    player.play();
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
  appActive = active;
  syncMusic();
}

function syncMusic(): void {
  if (!music) return;
  try {
    if (useSettings.getState().musicOn && appActive) {
      if (!music.playing) music.play();
    } else if (music.playing) {
      music.pause();
    }
  } catch {
    // ignore
  }
}
