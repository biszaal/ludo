/**
 * Which pooled player a one-shot effect should use.
 *
 * This module used to carry a much larger apparatus — a `parked` flag, a
 * generation counter, and a "quiet sweep" that rewound players between turns —
 * built on the belief that expo-audio's `play()` and `pause()` post to the
 * Android main looper and return. They do not. `AudioModule.kt` implements both
 * as
 *
 *     private fun <T> runOnMain(block: () -> T): T =
 *       runBlocking(appContext.mainQueue.coroutineContext) { block() }
 *
 * so a `play()` from JS BLOCKS the JS thread until the Android main thread
 * drains and runs the block. Nothing is queued behind anything; there is no
 * ordering hazard between a seek and the play that follows it, because the play
 * cannot return until the main queue has already run the seek that was
 * dispatched onto it first. Three rounds of cleverer JS-side scheduling were
 * therefore protecting an invariant that was never at risk, which is why none of
 * them fixed the Android silence.
 *
 * What IS scarce is the main thread itself, and every pooled player makes it
 * scarcer: each expo-audio player builds an ExoPlayer pinned to
 * `context.mainLooper`, a media3 `MediaSession`, and a status-polling coroutine
 * on `Dispatchers.Main` (AudioPlayer.kt, BaseAudioPlayer.kt). Growing the hop
 * pool to eight to dodge main-thread contention added eight more contenders for
 * it. So the pools are now as small as the sound actually needs, and the rule
 * below is the whole rule.
 */

/** One pooled player's state, as JS believes it to be. */
export interface Slot {
  /**
   * Epoch ms at which this slot's clip finishes. 0 = idle.
   *
   * Tracked in JS from the clip's measured length rather than asked of the
   * native player: `.playing` and `.currentTime` are `runOnMain` property reads,
   * so each one would block the JS thread on the busy main thread — on every
   * hop, to learn something we already know.
   */
  busyUntil: number;
}

/** A newly created player: loaded, at position 0, never played. */
export function freshSlot(): Slot {
  return { busyUntil: 0 };
}

/**
 * Choose a slot, preferring a finished one and otherwise the slot that finishes
 * soonest — the least audible interruption when a burst outruns its pool.
 *
 * There is no "needs a rewind" answer any more. The caller seeks every slot to 0
 * before playing it, because all three states a pooled player can be in want
 * exactly that: a finished ExoPlayer still holds `playWhenReady`, so the seek
 * alone restarts it; a never-played one is already at 0, so the seek is free;
 * and one being stolen mid-clip is meant to restart. One rule, no bookkeeping
 * that can drift out of step with the native player.
 *
 * `now` is passed in rather than read so the rule stays pure.
 */
export function pickSlot(slots: readonly Slot[], now: number): number {
  let earliest = 0;

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    if (slot.busyUntil <= now) return i;
    if (slots[earliest]!.busyUntil > slot.busyUntil) earliest = i;
  }

  return earliest;
}
