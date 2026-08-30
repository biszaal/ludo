/**
 * The pooled-player picker behind the Android hop/dice silence.
 *
 * The rule that matters most is the first one: a slot already parked at 0 must
 * win, because playing it needs no `seekTo` — and on Android a `seekTo` is an
 * async hop through the main looper, which during a hop animation is exactly
 * the thread that has no time to spare. Every other case is about not cutting
 * a clip that is still audibly sounding.
 */

import { describe, expect, it } from "vitest";
import { freshSlot, pickSlot, type Slot } from "../src/lib/soundPool";

const NOW = 10_000;

/** A pool of `n` untouched players. */
const fresh = (n: number): Slot[] => Array.from({ length: n }, freshSlot);

describe("pickSlot", () => {
  it("plays a fresh pool without asking for a rewind", () => {
    expect(pickSlot(fresh(4), NOW)).toEqual({ index: 0, rewind: false });
  });

  it("prefers a parked slot over an unparked one that is equally free", () => {
    const slots: Slot[] = [
      { busyUntil: 0, parked: false },
      { busyUntil: 0, parked: true },
    ];
    // Index 1 costs no seek, so it wins despite index 0 coming first.
    expect(pickSlot(slots, NOW)).toEqual({ index: 1, rewind: false });
  });

  it("rewinds a finished-but-unparked slot rather than cutting off a live one", () => {
    const slots: Slot[] = [
      { busyUntil: NOW + 500, parked: false }, // still sounding
      { busyUntil: NOW - 10, parked: false }, // finished, re-park never landed
    ];
    expect(pickSlot(slots, NOW)).toEqual({ index: 1, rewind: true });
  });

  it("treats a slot finishing exactly now as free", () => {
    const slots: Slot[] = [{ busyUntil: NOW, parked: false }];
    expect(pickSlot(slots, NOW)).toEqual({ index: 0, rewind: true });
  });

  it("steals the slot closest to finishing when the whole pool is sounding", () => {
    const slots: Slot[] = [
      { busyUntil: NOW + 300, parked: false },
      { busyUntil: NOW + 100, parked: false }, // closest to done — least missed
      { busyUntil: NOW + 200, parked: false },
    ];
    expect(pickSlot(slots, NOW)).toEqual({ index: 1, rewind: true });
  });

  it("never asks a single-player pool to go silent under repeat presses", () => {
    const slots: Slot[] = [{ busyUntil: NOW + 1_000, parked: false }];
    expect(pickSlot(slots, NOW)).toEqual({ index: 0, rewind: true });
  });

  /**
   * The reported bug, as a sequence: hops 175ms apart on a pool of 4, on a
   * device so loaded that no re-park ever lands (`parked` stays false and
   * busyUntil is the only thing separating the slots). Every hop must still
   * pick a genuinely finished slot — the old code instead re-seeked whichever
   * slot the cursor landed on and awaited the seek, losing the sound.
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
      slots[index] = { busyUntil: now + HOP_MS, parked: false };
    }

    expect(picks).toHaveLength(12);
  });
});
