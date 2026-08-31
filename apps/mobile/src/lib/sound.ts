/**
 * Sound layer. Effects round-robin small player pools so rapid overlapping
 * plays all sound; a separate looping player carries the ambient music. All
 * calls are best-effort — audio never blocks gameplay, and failures (e.g.
 * simulator quirks) are ignored. Effects respect settings.soundOn, music
 * respects settings.musicOn plus the app's foreground state.
 */

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { freshSlot, parkOnFinish, pickSlot, type Slot } from "./soundPool";
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
  hop: { source: require("../../assets/audio/sfx/hop.wav"), pool: 4, volume: 0.5, ms: 130 },
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
    delete slots[name];
  }
  for (const pool of Object.values(pools)) {
    for (const p of pool) {
      try {
        p.release();
      } catch {
        // already released or context torn down
      }
    }
  }
  try {
    music?.release();
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
  const mine: Slot[] = Array.from({ length: spec.pool }, freshSlot);
  pools[name] = Array.from({ length: spec.pool }, (_, i) => {
    const player = createAudioPlayer(spec.source);
    player.volume = spec.volume;
    // Park finished players back at 0, and only mark the slot parked once the
    // rewind has actually LANDED. On Android that seek is a hop through the
    // main looper, so under animation load it can arrive several frames late —
    // and a slot wrongly believed to be at 0 is a silent play.
    player.addListener("playbackStatusUpdate", (status) => {
      if (!status.didJustFinish) return;
      const slot = mine[i]!;
      // The notice may be stale: it comes off the Android main thread, which a
      // hop chain has saturated, so it can arrive after this slot was already
      // handed to the next clip. Parking it then would pause a sound that has
      // only just started — see parkOnFinish.
      if (!parkOnFinish(slot, Date.now())) return;
      slot.busyUntil = 0;
      try {
        player.pause();
      } catch {
        // ignore
      }
      void player
        .seekTo(0)
        .then(() => {
          slot.parked = true;
        })
        .catch(() => {});
    });
    return player;
  });
  slots[name] = mine;
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
  try {
    // Never AWAIT the rewind. Both calls land on the same Android main queue in
    // the order they are issued — the seek first, then the play — so the clip
    // still starts from the top, but without a round trip back into JS that on
    // a loaded main thread arrives long after the moment it was meant for.
    // Awaiting it here is what made hops and dice rolls silent on Android.
    if (rewind) void player.seekTo(0).catch(() => {});
    player.play();
  } catch {
    // ignore
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
