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
 * Choose a slot: the one whose clip ended longest ago, or, when the whole pool
 * is sounding, the one that finishes soonest — the least audible interruption
 * when a burst outruns its pool. Both are simply the smallest `busyUntil`.
 *
 * Longest-idle rather than first-free is the point. `busyUntil` is when JS
 * THINKS a clip ended, and the device starts every clip some tens of ms after it
 * was asked to, by an amount JS never sees. First-free handed every hop to
 * player 0 — its clip had "ended" 20ms before the next hop was due — so the next
 * rewind often landed on a clip still ringing and chopped it off mid-wave, which
 * is what the overlapping hops were. Rotating gives each player a whole step of
 * slack.
 *
 * There is no "needs a rewind" answer any more. The caller seeks every slot to 0
 * before playing it, because all three states a pooled player can be in want
 * exactly that: a finished ExoPlayer still holds `playWhenReady`, so the seek
 * alone restarts it; a never-played one is already at 0, so the seek is free;
 * and one being stolen mid-clip is meant to restart. One rule, no bookkeeping
 * that can drift out of step with the native player.
 */
export function pickSlot(slots: readonly Slot[]): number {
  let best = 0;
  for (let i = 1; i < slots.length; i++) {
    if (slots[i]!.busyUntil < slots[best]!.busyUntil) best = i;
  }
  return best;
}

/**
 * Whether a rewind that is fired and forgotten is guaranteed to have run by the
 * time the `play()` issued straight after it does.
 *
 * The paragraph at the top of this file is true of Android and only Android.
 * The two platforms implement the same two JS calls the opposite way round:
 *
 *   Android (AudioModule.kt) — `AsyncFunction("seekTo").runOnQueue(Queues.MAIN)`
 *     and `Function("play") { runOnMain { … } }`, where `runOnMain` is
 *     `runBlocking(mainQueue)`. The seek goes onto the main queue first and the
 *     play cannot return until that queue has drained past it. Ordering is free,
 *     and WAITING is the thing that costs: it puts a round trip back into JS on
 *     the one thread a hop animation has already saturated, which is what made
 *     Android silent.
 *
 *   iOS (AudioModule.swift) — `AsyncFunction("seekTo")` with no `runOnQueue`,
 *     whose body awaits `AVPlayer.seek(to:completionHandler:)` off the JS
 *     thread, and `Function("play")`, which is synchronous and runs inline the
 *     instant JS calls it. So the play happens FIRST and the seek lands after
 *     it, every time.
 *
 * That inversion is audible because a pooled player that finished its last clip
 * is parked at the END of it, with `actionAtItemEnd = .pause` (AudioPlayer.swift).
 * `playImmediately(atRate:)` does not rewind, so the play has nothing to play;
 * the late seek then returns the playhead to 0 on a player that has already
 * stopped. The slot sounds again on the play after that — hence iOS going
 * patchy rather than silent, and hence a pool of one (dice, capture, tap)
 * dropping every other press.
 *
 * Unknown platforms take the waiting branch: waiting when you did not have to
 * costs a few milliseconds of lead-in, and not waiting when you did costs the
 * sound.
 */
export function rewindLandsBeforePlay(platform: string): boolean {
  return platform === "android";
}

/**
 * What to hand the native player's `volume`, given the sound's own mixed level
 * and the channel master from settings.
 *
 * A plain multiply, with two guards that are not decoration. expo-audio
 * documents `volume` as 0..1 and says nothing about what a platform does with
 * a value outside it, so the result is clamped rather than trusted; and a
 * non-finite master (a NaN that survived a gesture) falls back to the authored
 * level, because the failure mode of the alternative is a game that is silent
 * for reasons nothing on screen explains.
 */
export function effectiveVolume(base: number, master: number): number {
  if (!Number.isFinite(master)) return base;
  return Math.min(1, Math.max(0, base * master));
}

/**
 * How long the picture itself takes to reach the screen after a frame is drawn:
 * a frame or two of the display pipeline. A sound only has to be early by the
 * difference between its own delay and this.
 */
export const DISPLAY_LATENCY_MS = 20;

/**
 * The most a sound will ever be asked for ahead of its beat. Bluetooth
 * headphones reach ~300ms; a measurement past this is a failed one, and asking
 * that far ahead would put the thock on the hop before.
 */
export const MAX_SOUND_LEAD_MS = 400;

/**
 * One calibration trial: a clip was asked to play at `askedAtMs`, and at
 * `readAtMs` the player reported `positionSec` of it played. What it has played
 * is what has been HEARD — both players keep their clocks on the audio output,
 * which is how video stays in sync with sound — so sound began at
 * `readAtMs - positionSec`, and the difference from the ask is the delay.
 */
export function latencyFromTrial(askedAtMs: number, readAtMs: number, positionSec: number): number {
  return readAtMs - positionSec * 1000 - askedAtMs;
}

/**
 * The lead to use, from a handful of calibration trials: the median delay (one
 * slow trial — a cold start, a hiccup — cannot move it), less the picture's own
 * delay, clamped to 0..MAX_SOUND_LEAD_MS. Trials that measured nothing
 * believable are dropped; with none left there is no measurement, and null says
 * so.
 */
export function leadFromLatencies(latenciesMs: readonly number[]): number | null {
  const valid = latenciesMs.filter((ms) => Number.isFinite(ms) && ms > 0 && ms < 1000).sort((a, b) => a - b);
  if (valid.length === 0) return null;
  const median = valid[Math.floor(valid.length / 2)]!;
  return Math.max(0, Math.min(MAX_SOUND_LEAD_MS, Math.round(median - DISPLAY_LATENCY_MS)));
}
