/**
 * Which pooled player a one-shot effect should use, and whether that player has
 * to be rewound before it will make a sound.
 *
 * This exists as its own pure module because of an Android bug it is the fix
 * for. In expo-audio, `play()` and `pause()` are synchronous native calls, but
 * `seekTo()` is an *async* one dispatched to the Android main looper — and so
 * are the `playing` / `currentTime` property reads (each one blocks the JS
 * thread until the main thread answers). The hop and dice sounds fire while
 * Reanimated and Skia have that same main thread saturated, so anything routed
 * through it arrives late: a `seekTo(0).then(play)` restart usually landed after
 * the hop it belonged to had already come and gone, and the finished-player
 * re-park that was supposed to restore the fast path was stuck in the same
 * queue. The result on Android was hops and dice rolls that were silent almost
 * every time, while the sounds that fire on an idle UI (messages, reaction
 * voices, taps) stayed perfectly reliable.
 *
 * So the pool now tracks in JS what it used to ask the native player: which
 * slots are still sounding, and which are known to sit at position 0. Picking a
 * slot costs no native calls at all, and the common case starts with a bare
 * synchronous `play()`.
 */

/** One pooled player's state, as JS believes it to be. */
export interface Slot {
  /** Epoch ms at which this slot's clip finishes. 0 = idle. */
  busyUntil: number;
  /** The slot is known to sit at position 0, so `play()` alone will sound it. */
  parked: boolean;
}

/** A newly created player: loaded, at position 0, never played. */
export function freshSlot(): Slot {
  return { busyUntil: 0, parked: true };
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
