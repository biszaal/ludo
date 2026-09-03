/**
 * The pooling rule behind the Android hop/dice silence.
 *
 * What is being tested shrank a great deal when the premise under the previous
 * three fixes turned out to be wrong (see lib/soundPool): expo-audio's `play()`
 * is `runBlocking` on the Android main queue, not a post-and-return, so a seek
 * dispatched before it has already run by the time it returns. With no ordering
 * hazard to defend against, there is no parked flag, no generation counter and
 * no quiet sweep — only "pick a player that is not sounding, and if they all
 * are, take the one with least left to lose".
 */

import { describe, expect, it } from "vitest";
import { freshSlot, pickSlot, type Slot } from "../src/lib/soundPool";

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
