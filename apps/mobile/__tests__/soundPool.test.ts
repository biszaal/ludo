/**
 * The pooling rules behind the Android hop/dice silence.
 *
 * The rule that matters most is the first one: a slot already parked at 0 must
 * win, because playing it needs no `seekTo` — and on Android a `seekTo` is an
 * async hop through the main looper, which during a hop animation is exactly
 * the thread that has no time to spare. Everything else here serves that: the
 * quiet sweep is how a slot becomes parked again without putting a seek back on
 * the busy thread, `stillOwns` is what stops a late seek lying about a slot it
 * no longer owns, and the remaining `pickSlot` cases are about not cutting off a
 * clip that is still audibly sounding.
 */

import { describe, expect, it } from "vitest";
import { freshSlot, pickSlot, slotsToPark, stillOwns, type Slot } from "../src/lib/soundPool";

const NOW = 10_000;

/** A pool of `n` untouched players. */
const fresh = (n: number): Slot[] => Array.from({ length: n }, freshSlot);

/** One slot in a given state. `gen` only matters to the rewind race below. */
const slot = (busyUntil: number, parked: boolean, gen = 0): Slot => ({ busyUntil, parked, gen });

describe("pickSlot", () => {
  it("plays a fresh pool without asking for a rewind", () => {
    expect(pickSlot(fresh(4), NOW)).toEqual({ index: 0, rewind: false });
  });

  it("prefers a parked slot over an unparked one that is equally free", () => {
    const slots: Slot[] = [
      slot(0, false),
      slot(0, true),
    ];
    // Index 1 costs no seek, so it wins despite index 0 coming first.
    expect(pickSlot(slots, NOW)).toEqual({ index: 1, rewind: false });
  });

  it("rewinds a finished-but-unparked slot rather than cutting off a live one", () => {
    const slots: Slot[] = [
      slot(NOW + 500, false), // still sounding
      slot(NOW - 10, false), // finished, re-park never landed
    ];
    expect(pickSlot(slots, NOW)).toEqual({ index: 1, rewind: true });
  });

  it("treats a slot finishing exactly now as free", () => {
    const slots: Slot[] = [slot(NOW, false)];
    expect(pickSlot(slots, NOW)).toEqual({ index: 0, rewind: true });
  });

  it("steals the slot closest to finishing when the whole pool is sounding", () => {
    const slots: Slot[] = [
      slot(NOW + 300, false),
      slot(NOW + 100, false), // closest to done — least missed
      slot(NOW + 200, false),
    ];
    expect(pickSlot(slots, NOW)).toEqual({ index: 1, rewind: true });
  });

  it("never asks a single-player pool to go silent under repeat presses", () => {
    const slots: Slot[] = [slot(NOW + 1_000, false)];
    expect(pickSlot(slots, NOW)).toEqual({ index: 0, rewind: true });
  });

  /**
   * The degenerate case, kept: hops 175ms apart on a pool of 4, on a device so
   * loaded that no re-park ever lands (`parked` stays false and busyUntil is the
   * only thing separating the slots). Every hop must still pick a genuinely
   * finished slot — the original bug re-seeked whichever slot the cursor landed
   * on and awaited the seek, losing the sound.
   */
  it("keeps every hop audible at the real 175ms cadence with no re-parks", () => {
    const HOP_MS = 130;
    const STEP_MS = 175;
    const slots = fresh(4);
    const picks: number[] = [];

    for (let i = 0; i < 12; i++) {
      const now = NOW + i * STEP_MS;
      const { index } = pickSlot(slots, now);
      // A slot is only ever taken when its previous clip has finished.
      expect(slots[index]!.busyUntil).toBeLessThanOrEqual(now);
      picks.push(index);
      slots[index] = slot(now + HOP_MS, false);
    }

    expect(picks).toHaveLength(12);
  });

  /**
   * What the hop pool is actually sized for.
   *
   * A six-cell move plus a captured pawn's retrace is around seven thocks
   * 150ms apart, and the sweep has re-parked every slot in the gap since the
   * last turn. On a pool of eight the whole burst must ask for ZERO rewinds —
   * that is the fix: one queued main-thread op per hop, on the one path a
   * saturated thread cannot spoil. On the old pool of four the back half of the
   * burst wrapped around and paid a seek each, on the thread that had no time.
   */
  it("asks for no rewind at all across a whole hop burst", () => {
    const HOP_MS = 130;
    const STEP_MS = 150;
    const slots = fresh(8);
    let rewinds = 0;

    for (let i = 0; i < 7; i++) {
      const now = NOW + i * STEP_MS;
      const { index, rewind } = pickSlot(slots, now);
      if (rewind) rewinds++;
      slots[index] = slot(now + HOP_MS, false);
    }

    expect(rewinds).toBe(0);
  });
});

/**
 * A rewind that lands late must not be believed about the clip that replaced it.
 *
 * `seekTo` resolves off the Android main looper, which during a hop chain is
 * exactly the thread Reanimated and Skia have saturated. So the answer for the
 * seek that was parking slot N can arrive AFTER slot N has been handed to clip
 * N+1 and told to play. Marking it "parked at 0" then is a lie about a player
 * that is mid-clip, and it costs the sound AFTER that one: the next play trusts
 * `parked`, skips its rewind, and starts from wherever the clip had got to.
 *
 * This is the same late-main-thread problem the pool sizes and the quiet sweep
 * exist to avoid, arriving from the one direction they cannot cover.
 */
describe("stillOwns", () => {
  it("believes an answer for the clip that asked for it", () => {
    expect(stillOwns(slot(0, false, 7), 7)).toBe(true);
  });

  it("discards an answer for a slot that has moved on", () => {
    expect(stillOwns(slot(0, false, 8), 7)).toBe(false);
  });

  it("keeps a re-issued slot honest across a whole hop chain of late answers", () => {
    // Every rewind answers one full step late — the worst realistic case. Not
    // one of them may mark the slot parked, because the slot is sounding every
    // time.
    const STEP_MS = 150;
    const HOP_MS = 130;
    const s0 = freshSlot();
    let wronglyParked = 0;

    for (let i = 0; i < 10; i++) {
      const now = NOW + i * STEP_MS;
      const claimed = ++s0.gen;
      s0.busyUntil = now + HOP_MS;
      s0.parked = false;
      // The PREVIOUS clip's rewind resolves here, a step behind.
      if (i > 0 && stillOwns(s0, claimed - 1)) wronglyParked++;
    }

    expect(wronglyParked).toBe(0);
  });
});

/**
 * The quiet sweep: which players get rewound once a pool has gone silent.
 *
 * Rewinding is what puts a slot back on the one-op `play()` path, and doing it
 * per-clip is what put the seeks back onto the congested thread. So it happens
 * in the gap between turns instead — and by then the answer is usually "all of
 * them", which is the point. The two exclusions are what stop the sweep doing
 * harm on the way.
 */
describe("slotsToPark", () => {
  it("rewinds every slot a burst left unparked", () => {
    const slots = [slot(NOW - 500, false), slot(NOW - 300, false), slot(NOW - 100, false)];
    expect(slotsToPark(slots, NOW)).toEqual([0, 1, 2]);
  });

  it("leaves an already-parked slot alone", () => {
    // Re-seeking it would put a needless op back on the main thread, which is
    // the whole thing this module exists to avoid.
    expect(slotsToPark(fresh(4), NOW)).toEqual([]);
  });

  it("never pauses a slot that is still sounding", () => {
    // A chat message landing exactly as the sweep runs must not be cut off.
    const slots = [slot(NOW - 10, false), slot(NOW + 200, false)];
    expect(slotsToPark(slots, NOW)).toEqual([0]);
  });

  it("hands a whole pool back to the fast path", () => {
    // The property the pool sizes rest on: after a sweep, the next burst finds
    // parked players and pays no seeks at all.
    const slots = [slot(NOW - 500, false), slot(NOW - 400, false), slot(NOW - 300, false)];
    for (const i of slotsToPark(slots, NOW)) slots[i]!.parked = true;
    expect(pickSlot(slots, NOW)).toEqual({ index: 0, rewind: false });
  });
});
