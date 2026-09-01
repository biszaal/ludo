/**
 * Which pooled player a one-shot effect should use, and which players are idle
 * enough to be rewound.
 *
 * This exists as its own pure module because of an Android bug it is the fix
 * for. In expo-audio, `play()` and `pause()` are synchronous JS-side calls whose
 * bodies post to the Android MAIN looper, and `seekTo()` is an async function
 * dispatched to that same looper (see AudioModule.kt: `runOnMain { … }` and
 * `AsyncFunction("seekTo").runOnQueue(Queues.MAIN)`). The hop and dice sounds
 * fire while Reanimated and Skia have that exact thread saturated, so everything
 * routed through it arrives late — and a slot that needs a rewind costs TWO
 * queued ops per play. Several of those pile up and interleave as
 * `seek(0), play, seek(0), play`, where each seek restarts the clip the
 * preceding play had just begun: N hops collapse into one audible thock. On
 * Android that read as hops and dice rolls being silent most of the time, while
 * sounds that fire on an idle UI (messages, reaction voices, taps) stayed
 * perfectly reliable.
 *
 * Two rules follow, and both live here so they can be tested in Node:
 *
 *   1. PICK A PARKED SLOT. A player known to sit at position 0 plays with a bare
 *      `play()` — one queued op, and the only path that cannot be spoilt by a
 *      busy main thread. Pools are sized so a whole burst finds parked players.
 *   2. REWIND IN THE QUIET. Rewinding is what makes a slot parked again, and
 *      doing it per-clip puts the seeks back onto the congested thread. The
 *      caller instead sweeps a pool once it has been silent for a beat, which is
 *      between turns — when the main thread has nothing else to do.
 */

/** One pooled player's state, as JS believes it to be. */
export interface Slot {
  /** Epoch ms at which this slot's clip finishes. 0 = idle. */
  busyUntil: number;
  /** The slot is known to sit at position 0, so `play()` alone will sound it. */
  parked: boolean;
  /**
   * Bumped every time the slot is handed to a clip.
   *
   * The rewind that parks a slot finishes asynchronously — `seekTo` returns a
   * promise that resolves off the main looper, which under load can be several
   * frames late. By then the slot may already have been handed to the next clip,
   * and marking THAT one "parked at 0" is a lie that costs the sound after it:
   * the next play would skip its rewind and start from wherever the clip had
   * got to. Comparing the generation is how a late answer knows it is stale.
   */
  gen: number;
}

/** A newly created player: loaded, at position 0, never played. */
export function freshSlot(): Slot {
  return { busyUntil: 0, parked: true, gen: 0 };
}

export interface Pick {
  /** Index into the pool. */
  index: number;
  /** The slot is not at position 0 — issue a rewind before playing it. */
  rewind: boolean;
}

/**
 * Choose a slot, preferring (in order):
 *
 *  1. a finished slot already parked at 0 — plays with no seek at all, the one
 *     path that cannot be delayed by a busy main thread;
 *  2. any other finished slot — needs a rewind, but cuts nothing off;
 *  3. the slot that finishes soonest, when every one is still sounding — the
 *     least audible interruption of an overlapping burst.
 *
 * `now` is passed in rather than read so the rule stays pure.
 */
export function pickSlot(slots: readonly Slot[], now: number): Pick {
  let firstFree = -1;
  let earliest = 0;

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    if (slot.busyUntil <= now) {
      // A parked free slot is the best case there is — take it immediately.
      if (slot.parked) return { index: i, rewind: false };
      if (firstFree === -1) firstFree = i;
    }
    if (slots[earliest]!.busyUntil > slot.busyUntil) earliest = i;
  }

  if (firstFree !== -1) return { index: firstFree, rewind: true };
  return { index: earliest, rewind: true };
}

/**
 * Which slots the quiet sweep should rewind: everything that has finished
 * sounding and is not already known to sit at 0.
 *
 * The caller runs this only after a pool has been silent for a beat, so in
 * practice every slot qualifies — but the checks are not decoration. A sound
 * that fires exactly as the sweep lands (a chat message during the pause between
 * turns) must not have its player paused out from under it, and re-seeking a
 * slot that is already parked would put a needless op back on the main thread,
 * which is the whole thing this module exists to avoid.
 *
 * Pure and clock-injected, like pickSlot.
 */
export function slotsToPark(slots: readonly Slot[], now: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    if (!slot.parked && slot.busyUntil <= now) out.push(i);
  }
  return out;
}

/**
 * Is a rewind that has just landed still about the clip that asked for it?
 *
 * See `Slot.gen`. False means the slot was handed on while the seek was in
 * flight, and the answer must be discarded rather than believed.
 */
export function stillOwns(slot: Slot, gen: number): boolean {
  return slot.gen === gen;
}
