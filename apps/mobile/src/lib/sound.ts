/**
 * Sound layer. Effects round-robin small player pools so rapid overlapping
 * plays all sound; a separate looping player carries the ambient music. All
 * calls are best-effort — audio never blocks gameplay, and failures (e.g.
 * simulator quirks) are ignored. Effects respect settings.soundOn, music
 * respects settings.musicOn plus the app's foreground state.
 */

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { useSettings } from "../store/settingsStore";

export type SoundName =
  | "hop" | "dice" | "capture" | "finish" | "win" | "tap" | "turn" | "ding" | "pop" | "msg" | "safe"
  | "laugh" | "crying" | "angry" | "tease" | "cheer" | "shock";

const SPECS: Record<SoundName, { source: number; pool: number; volume: number }> = {
  hop: { source: require("../../assets/hop.wav"), pool: 4, volume: 0.5 },
  dice: { source: require("../../assets/dice.wav"), pool: 2, volume: 0.6 },
  capture: { source: require("../../assets/capture.wav"), pool: 2, volume: 0.55 },
  finish: { source: require("../../assets/finish.wav"), pool: 2, volume: 0.5 },
  win: { source: require("../../assets/win.wav"), pool: 1, volume: 0.6 },
  tap: { source: require("../../assets/tap.wav"), pool: 2, volume: 0.35 },
  turn: { source: require("../../assets/turn.wav"), pool: 2, volume: 0.4 },
  ding: { source: require("../../assets/ding.wav"), pool: 2, volume: 0.5 },
  pop: { source: require("../../assets/pop.wav"), pool: 2, volume: 0.5 },
  msg: { source: require("../../assets/msg.wav"), pool: 2, volume: 0.45 },
  safe: { source: require("../../assets/safe.wav"), pool: 2, volume: 0.45 },
  // Reaction-emoji voices (gen-reaction-sfx.mjs) — one per expressive sprite.
  laugh: { source: require("../../assets/laugh.wav"), pool: 1, volume: 0.5 },
  crying: { source: require("../../assets/crying.wav"), pool: 1, volume: 0.5 },
  angry: { source: require("../../assets/angry.wav"), pool: 1, volume: 0.5 },
  tease: { source: require("../../assets/tease.wav"), pool: 1, volume: 0.5 },
  cheer: { source: require("../../assets/cheer.wav"), pool: 1, volume: 0.5 },
  shock: { source: require("../../assets/shock.wav"), pool: 1, volume: 0.5 },
};

const pools = {} as Record<SoundName, AudioPlayer[]>;
const cursors = {} as Record<SoundName, number>;
let ready = false;

let music: AudioPlayer | null = null;
let appActive = true;

/** Load all sounds, start music (if enabled) and allow playback in silent mode. */
export async function initSound(): Promise<void> {
  if (ready) return;
  try {
    await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: "mixWithOthers", shouldPlayInBackground: false });
  } catch {
    // non-fatal
  }
  try {
    for (const name of Object.keys(SPECS) as SoundName[]) {
      const spec = SPECS[name];
      pools[name] = Array.from({ length: spec.pool }, () => {
        const player = createAudioPlayer(spec.source);
        player.volume = spec.volume;
        // Park finished players back at 0. A player left at the end of its clip
        // makes the next play() silently no-op (seekTo is async and loses the
        // race) — this priming is what keeps rapid one-shots reliable.
        player.addListener("playbackStatusUpdate", (status) => {
          if (status.didJustFinish) {
            player.pause();
            void player.seekTo(0).catch(() => {});
          }
        });
        return player;
      });
      cursors[name] = 0;
    }
    music = createAudioPlayer(require("../../assets/music.wav"));
    music.loop = true;
    music.volume = 0.25;
    ready = true;
  } catch {
    ready = false;
  }
  // React to the music toggle; effects check soundOn per play.
  useSettings.subscribe(() => syncMusic());
  syncMusic();
}

/** Play a one-shot effect (no-op when sound is off or audio failed to load). */
export function playSound(name: SoundName): void {
  if (!ready || !useSettings.getState().soundOn) return;
  const pool = pools[name];
  if (!pool || pool.length === 0) return;
  const player = pool[cursors[name] % pool.length]!;
  cursors[name] += 1;
  try {
    if (player.playing || player.currentTime > 0.01) {
      // Mid-clip (pool wrapped) or not yet re-parked — restart once the seek lands.
      void player
        .seekTo(0)
        .then(() => player.play())
        .catch(() => {});
    } else {
      player.play(); // parked at 0 — instant start
    }
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
