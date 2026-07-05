/**
 * Sound layer. Effects round-robin small player pools so rapid overlapping
 * plays all sound; a separate looping player carries the ambient music. All
 * calls are best-effort — audio never blocks gameplay, and failures (e.g.
 * simulator quirks) are ignored. Effects respect settings.soundOn, music
 * respects settings.musicOn plus the app's foreground state.
 */

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { useSettings } from "../store/settingsStore";

export type SoundName = "hop" | "dice" | "capture" | "finish" | "win" | "tap" | "turn" | "ding";

const SPECS: Record<SoundName, { source: number; pool: number; volume: number }> = {
  hop: { source: require("../../assets/hop.wav"), pool: 4, volume: 0.5 },
  dice: { source: require("../../assets/dice.wav"), pool: 2, volume: 0.6 },
  capture: { source: require("../../assets/capture.wav"), pool: 2, volume: 0.55 },
  finish: { source: require("../../assets/finish.wav"), pool: 2, volume: 0.5 },
  win: { source: require("../../assets/win.wav"), pool: 1, volume: 0.6 },
  tap: { source: require("../../assets/tap.wav"), pool: 2, volume: 0.35 },
  turn: { source: require("../../assets/turn.wav"), pool: 2, volume: 0.4 },
  ding: { source: require("../../assets/ding.wav"), pool: 2, volume: 0.5 },
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
    await setAudioModeAsync({ playsInSilentMode: true });
  } catch {
    // non-fatal
  }
  try {
    for (const name of Object.keys(SPECS) as SoundName[]) {
      const spec = SPECS[name];
      pools[name] = Array.from({ length: spec.pool }, () => {
        const player = createAudioPlayer(spec.source);
        player.volume = spec.volume;
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
    player.seekTo(0);
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
