/**
 * The pooling rules behind the hop/dice silence — on both platforms.
 *
 * Two separate rules live here and they broke in opposite directions.
 *
 * `pickSlot` is the Android story. What was being tested shrank a great deal
 * when the premise under three earlier fixes turned out to be wrong (see
 * lib/soundPool): expo-audio's `play()` is `runBlocking` on the Android main
 * queue, not a post-and-return, so a seek dispatched before it has already run
 * by the time it returns. With no ordering hazard to defend against there is no
 * parked flag, no generation counter and no quiet sweep — only "pick a player
 * that is not sounding, and if they all are, take the one with least left to
 * lose".
 *
 * `rewindLandsBeforePlay` is what that conclusion missed: it is true of Android
 * and false of iOS, and the fix wrote it into the caller as if it were true of
 * both. That is the iOS regression.
 */

import { describe, expect, it } from "vitest";
import { freshSlot, pickSlot, rewindLandsBeforePlay, type Slot } from "../src/lib/soundPool";

const NOW = 10_000;

/** A pool of `n` untouched players. */
const fresh = (n: number): Slot[] => Array.from({ length: n }, freshSlot);

const slot = (busyUntil: number): Slot => ({ busyUntil });

describe("pickSlot", () => {
  it("takes the first player of a fresh pool", () => {
    expect(pickSlot(fresh(3), NOW)).toBe(0);
  });

  it("passes over a slot that is still sounding", () => {
    expect(pickSlot([slot(NOW + 500), slot(NOW - 10)], NOW)).toBe(1);
  });

  it("treats a slot finishing exactly now as free", () => {
    expect(pickSlot([slot(NOW)], NOW)).toBe(0);
  });

  it("steals the slot closest to finishing when the whole pool is sounding", () => {
    const slots = [slot(NOW + 300), slot(NOW + 100), slot(NOW + 200)];
    expect(pickSlot(slots, NOW)).toBe(1);
  });

  it("never goes silent on a single-player pool under repeat presses", () => {
    // A tap during a tap: restarting the clip is right, and is what the caller's
    // unconditional seek-then-play does with this answer.
    expect(pickSlot([slot(NOW + 1_000)], NOW)).toBe(0);
  });

  /**
   * The case the hop pool is sized for: a six-cell move plus a captured pawn's
   * retrace, about seven thocks 150ms apart. The clip is 130ms, so at most one
   * hop is ever still sounding when the next arrives — three players is already
   * headroom, and every extra one is another ExoPlayer, MediaSession and
   * main-thread polling coroutine competing for the thread the sound has to
   * cross.
   */
  it("never cuts off a sounding hop across a whole burst", () => {
    const HOP_MS = 130;
    const STEP_MS = 150;
    const slots = fresh(3);

    for (let i = 0; i < 7; i++) {
      const now = NOW + i * STEP_MS;
      const index = pickSlot(slots, now);
      expect(slots[index]!.busyUntil).toBeLessThanOrEqual(now);
      slots[index] = slot(now + HOP_MS);
    }
  });

  /**
   * The degenerate cadence, kept from the original suite: two pawns landing on
   * the same frame are collapsed by Board's 70ms throttle, so 70ms is the
   * tightest gap a pool can be asked to serve. Three players cover a 130ms clip
   * at that rate with one to spare.
   */
  it("keeps every hop audible at the throttle's tightest cadence", () => {
    const HOP_MS = 130;
    const STEP_MS = 70;
    const slots = fresh(3);
    let cutOff = 0;

    for (let i = 0; i < 12; i++) {
      const now = NOW + i * STEP_MS;
      const index = pickSlot(slots, now);
      if (slots[index]!.busyUntil > now) cutOff++;
      slots[index] = slot(now + HOP_MS);
    }

    expect(cutOff).toBe(0);
  });
});

/**
 * Whether a fired-and-forgotten rewind is guaranteed to have run by the time
 * the `play()` issued after it does.
 *
 * A pooled player that has finished its previous clip is parked at the END of
 * that clip, so the rewind is not an optimisation — it is the difference
 * between the clip sounding and the player being told to resume from a
 * playhead that has nowhere left to go. Every play in the pool therefore
 * depends on this answer being right for the platform it is running on.
 */
describe("rewindLandsBeforePlay", () => {
  /**
   * Android: `AsyncFunction("seekTo").runOnQueue(Queues.MAIN)` and
   * `Function("play") { runOnMain { … } }`, where `runOnMain` is
   * `runBlocking(mainQueue)`. The seek is dispatched onto the main queue first
   * and the play cannot return until that queue has drained past it, so the
   * order is guaranteed by construction — and the caller must NOT wait, because
   * waiting means a round trip back into JS across the one thread a hop
   * animation has already saturated. That was the Android bug.
   */
  it("holds on Android, where play() blocks on the queue the seek was put on", () => {
    expect(rewindLandsBeforePlay("android")).toBe(true);
  });

  /**
   * iOS: the exact inverse. `seekTo` is an `AsyncFunction` with no
   * `runOnQueue`, whose body awaits `AVPlayer.seek(to:completionHandler:)` off
   * the JS thread; `play` is a synchronous `Function`, which runs inline on the
   * JS thread the instant it is called. So a fired-and-forgotten seek lands
   * AFTER its own play, every time — the play finds the playhead at the end of
   * the last clip and `playImmediately(atRate:)` has nothing to play, then the
   * late seek rewinds a player that is no longer going anywhere. The slot only
   * sounds again on the play after that, which is why iOS went patchy rather
   * than silent, and why a pool of one (dice, capture, tap) alternates.
   */
  it("does NOT hold on iOS, where the play runs inline and the seek does not", () => {
    expect(rewindLandsBeforePlay("ios")).toBe(false);
  });

  /**
   * Anything that is not Android gets the safe branch. Waiting for the rewind
   * costs a few milliseconds of lead-in; not waiting when you needed to costs
   * the sound outright, so an unknown runtime (web, tvOS, a future platform)
   * pays the cheaper mistake.
   */
  it("assumes the waiting branch on any runtime it does not know", () => {
    expect(rewindLandsBeforePlay("web")).toBe(false);
    expect(rewindLandsBeforePlay("windows")).toBe(false);
  });
});
