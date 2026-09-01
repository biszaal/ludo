/**
 * Sound layer. Effects round-robin small player pools so rapid overlapping
 * plays all sound; a separate looping player carries the ambient music. All
 * calls are best-effort — audio never blocks gameplay, and failures (e.g.
 * simulator quirks) are ignored. Effects respect settings.soundOn, music
 * respects settings.musicOn plus the app's foreground state.
 */

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { freshSlot, pickSlot, slotsToPark, stillOwns, type Slot } from "./soundPool";
import { useSettings } from "../store/settingsStore";

export type SoundName =
  | "hop" | "dice" | "capture" | "finish" | "win" | "tap" | "turn" | "ding" | "pop" | "msg" | "safe"
  | "laugh" | "crying" | "angry" | "tease" | "cheer" | "shock" | "thumbs" | "gg";

/**
 * `ms` is the clip's real length, measured from the file. The pool uses it to
 * know which players have finished — asking the native player instead
 * (`.playing` / `.currentTime`) means a blocking round trip to the Android main
 * thread on every single hop. See lib/soundPool.
 */
const SPECS: Record<SoundName, { source: number; pool: number; volume: number; ms: number }> = {
  // Eight, sized by the longest BURST rather than by the clip. A six-cell move
  // plus a captured pawn's retrace is ~7 thocks 150ms apart, and a slot is only
  // free of a rewind while it is still parked — so four players meant the back
  // half of every long move was paying a seek on a main thread that had no time
  // for it. Eight covers a whole burst from parked slots alone, and the quiet
  // sweep re-parks them all between turns. A 130ms mono clip costs nothing.
  hop: { source: require("../../assets/audio/sfx/hop.wav"), pool: 8, volume: 0.5, ms: 130 },
  dice: { source: require("../../assets/audio/sfx/dice.wav"), pool: 2, volume: 0.6, ms: 360 },
  capture: { source: require("../../assets/audio/sfx/capture.wav"), pool: 2, volume: 0.55, ms: 320 },
  finish: { source: require("../../assets/audio/sfx/finish.wav"), pool: 2, volume: 0.5, ms: 450 },
  win: { source: require("../../assets/audio/sfx/win.wav"), pool: 1, volume: 0.6, ms: 1100 },
  tap: { source: require("../../assets/audio/sfx/tap.wav"), pool: 2, volume: 0.35, ms: 50 },
  turn: { source: require("../../assets/audio/sfx/turn.wav"), pool: 2, volume: 0.4, ms: 90 },
  ding: { source: require("../../assets/audio/sfx/ding.wav"), pool: 2, volume: 0.5, ms: 600 },
  pop: { source: require("../../assets/audio/sfx/pop.wav"), pool: 2, volume: 0.5, ms: 140 },
  msg: { source: require("../../assets/audio/sfx/msg.wav"), pool: 2, volume: 0.45, ms: 280 },
  safe: { source: require("../../assets/audio/sfx/safe.wav"), pool: 2, volume: 0.45, ms: 400 },
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

const pools = {} as Record<SoundName, AudioPlayer[]>;
/** What JS believes each pooled player is doing. See lib/soundPool. */
const slots = {} as Record<SoundName, Slot[]>;
let ready = false;

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
  for (const name of Object.keys(pools) as SoundName[]) {
    const timer = sweepTimers[name];
    if (timer) clearTimeout(timer);
    sweepTimers[name] = null;
    delete slots[name];
  }
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
  // No `playbackStatusUpdate` listener, deliberately. Rewinding on the native
  // finish notice was the obvious place to do it and the wrong one: the notice
  // arrives over the Android main thread, which is saturated for the whole of a
  // hop chain, so the rewinds it triggered queued up alongside the plays they
  // were meant to precede — and it cost one native→JS event per clip on top.
  // The quiet sweep below does the same job when the thread is free.
  pools[name] = Array.from({ length: spec.pool }, () => {
    const player = createAudioPlayer(spec.source);
    player.volume = spec.volume;
    return player;
  });
}

/**
 * How long a pool must go untouched before its players are rewound.
 *
 * It has one job: outlast a BURST, so a sweep can only land after the pawn has
 * stopped moving. 600ms is four hops at HOP_STEP_MS, and every play pushes it
 * out again, so a twelve-cell chain defers it just as effectively as a short
 * one. The upper bound is the gap to the next burst — a whole turn — so there is
 * a great deal of room here and no reason to shave it.
 */
const QUIET_MS = 600;
const sweepTimers = {} as Record<SoundName, ReturnType<typeof setTimeout> | null>;

/**
 * Rewind a pool's finished players, once nothing has used it for a beat.
 *
 * This is the half of the fix that the pool sizes rest on: a slot only takes the
 * one-op `play()` path while it is parked, and playing it is what un-parks it.
 * Doing the rewind here rather than per-clip means every `seekTo` lands during
 * the gap between turns, when the main thread is idle, instead of in the middle
 * of the animation whose sound it was supposed to serve.
 */
function sweepPool(name: SoundName): void {
  const pool = pools[name];
  const mine = slots[name];
  if (!pool || !mine) return;
  for (const i of slotsToPark(mine, Date.now())) {
    const slot = mine[i]!;
    const player = pool[i]!;
    const gen = slot.gen;
    try {
      // Load-bearing, not tidiness: a finished ExoPlayer still has
      // playWhenReady set, so seeking it back to 0 without pausing first replays
      // the clip out loud.
      player.pause();
    } catch {
      // ignore
    }
    void player
      .seekTo(0)
      .then(() => {
        if (stillOwns(slot, gen)) slot.parked = true;
      })
      .catch(() => {});
  }
}

/** Push the sweep out to `QUIET_MS` from now — called on every play, so a burst
 *  keeps deferring it and only the silence after the burst lets it run. */
function deferSweep(name: SoundName): void {
  const running = sweepTimers[name];
  if (running) clearTimeout(running);
  sweepTimers[name] = setTimeout(() => {
    sweepTimers[name] = null;
    sweepPool(name);
  }, QUIET_MS);
}

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
    music = createAudioPlayer(require("../../assets/audio/music/music.wav"));
    music.loop = true;
    music.volume = 0.25;
    ready = true;
  } catch {
    ready = false;
  }
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
  if (!ready || !useSettings.getState().soundOn) return;
  if (!pools[name] && DEFERRED.has(name)) buildPool(name);
  const pool = pools[name];
  const mine = slots[name];
  if (!pool || pool.length === 0 || !mine) return;

  const now = Date.now();
  const { index, rewind } = pickSlot(mine, now);
  const player = pool[index]!;
  const slot = mine[index]!;
  slot.busyUntil = now + SPECS[name].ms;
  slot.parked = false;
  // Claims the slot for this clip: anything still in flight for the last one is
  // now stale. See Slot.gen.
  slot.gen++;
  try {
    // Never AWAIT the rewind. Both calls land on the same Android main queue in
    // the order they are issued — the seek first, then the play — so the clip
    // still starts from the top, but without a round trip back into JS that on
    // a loaded main thread arrives long after the moment it was meant for.
    // Awaiting it here is what made hops and dice rolls silent on Android.
    //
    // `rewind` should be rare: the pools are sized so a burst finds parked
    // players, and the sweep re-parks them in the quiet afterwards. It is the
    // fallback for a burst longer than the pool, not the normal path.
    if (rewind) void player.seekTo(0).catch(() => {});
    player.play();
  } catch {
    // ignore
  }
  deferSweep(name);
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
