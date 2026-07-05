/**
 * Tiny sound-effects layer. Each effect has a small pool of audio players that
 * round-robins so rapid, overlapping plays all sound. All calls are best-effort:
 * audio never blocks gameplay, and failures (e.g. simulator) are ignored.
 */

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

type SoundName = "hop" | "dice";

const SPECS: Record<SoundName, { source: number; pool: number; volume: number }> = {
  hop: { source: require("../../assets/hop.wav"), pool: 4, volume: 0.5 },
  dice: { source: require("../../assets/dice.wav"), pool: 2, volume: 0.6 },
};

const pools: Record<SoundName, AudioPlayer[]> = { hop: [], dice: [] };
const cursors: Record<SoundName, number> = { hop: 0, dice: 0 };
let ready = false;

/** Load all sounds and allow playback in silent mode. Call once at startup. */
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
    }
    ready = true;
  } catch {
    ready = false;
  }
}

function play(name: SoundName): void {
  if (!ready) return;
  const pool = pools[name];
  if (pool.length === 0) return;
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
export const playHop = (): void => play("hop");

/** The dice rattle — call when a roll begins. */
export const playDiceRoll = (): void => play("dice");
