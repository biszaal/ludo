/**
 * A pawn's walk, driven by ONE clock.
 *
 * The hop used to be two chains of timings — one per cell for x, two per cell
 * (up, down) for y. Reanimated starts each link of a chain on the frame the
 * previous one finished, so the part of that frame that ran past the finish is
 * thrown away, at every link. y has twice the links, so it lost twice the
 * time: measured by simulation, a six-cell move at 60Hz took 1000ms instead of
 * 900, and each landing trailed its cell by ~40ms — the pawn came down beside
 * the square instead of on it, and stalled at every cell. That is the "hopping
 * isn't smooth" report, and 60Hz is what every opponent's move runs at.
 *
 * One clock counting cells walked cannot drift against itself: position, lift,
 * landing and thock are all read off the same number.
 */

import { describe, expect, it } from "vitest";
import { HOP_AIR, HOP_SOUND_AT, cuesBy, hopHeight, landingsBy, walkPoint } from "../src/render/walkPath";

const from = { x: 0, y: 0 };
/** Six cells in a row, 10px apart, then a turn upward — a track corner. */
const route = [
  { x: 10, y: 0 },
  { x: 20, y: 0 },
  { x: 30, y: 0 },
  { x: 30, y: -10 },
  { x: 30, y: -20 },
  { x: 30, y: -30 },
];
const LIFT = 4;

describe("walkPoint", () => {
  it("stands on the start before the walk and on each cell as it lands", () => {
    expect(walkPoint(from, route, 0, 1)).toEqual(from);
    route.forEach((cell, i) => {
      const p = walkPoint(from, route, i + 1, 1);
      expect(p.x).toBeCloseTo(cell.x, 10);
      expect(p.y).toBeCloseTo(cell.y, 10);
    });
  });

  it("travels during the jump and then sits on the cell", () => {
    // The sit is part of what reads as a hop. Without it the pawn touched each
    // cell for an instant and took off again — at 120Hz that looked like gliding.
    expect(walkPoint(from, route, HOP_AIR / 2, HOP_AIR).x).toBeCloseTo(5, 10);
    for (let k = 1; k <= route.length; k++) {
      const touchdown = k - 1 + HOP_AIR;
      for (const t of [touchdown, (touchdown + k) / 2, k]) {
        const p = walkPoint(from, route, t, HOP_AIR);
        expect(p.x).toBeCloseTo(route[k - 1]!.x, 10);
        expect(p.y).toBeCloseTo(route[k - 1]!.y, 10);
      }
    }
  });

  it("has no jump where one step hands over to the next", () => {
    for (const air of [1, HOP_AIR]) {
      for (let k = 1; k < route.length; k++) {
        const before = walkPoint(from, route, k - 1e-9, air);
        const after = walkPoint(from, route, k + 1e-9, air);
        expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1e-6);
      }
    }
  });

  it("glides straight along the route with no sit (a captured pawn's slide home)", () => {
    expect(walkPoint(from, route, 3.5, 1).y).toBeCloseTo(-5, 10);
  });

  it("clamps a clock that runs past either end", () => {
    expect(walkPoint(from, route, -1, HOP_AIR)).toEqual(from);
    expect(walkPoint(from, route, 99, HOP_AIR)).toEqual({ x: 30, y: -30 });
  });

  it("stays where it is with nowhere to go", () => {
    expect(walkPoint(from, [], 3, HOP_AIR)).toEqual(from);
  });
});

describe("hopHeight", () => {
  it("is off the ground only while jumping, peaking mid-jump", () => {
    expect(hopHeight(0, 6, HOP_AIR)).toBe(0);
    expect(hopHeight(HOP_AIR / 2, 6, HOP_AIR)).toBeCloseTo(1, 10);
    expect(hopHeight(2 + HOP_AIR / 2, 6, HOP_AIR)).toBeCloseTo(1, 10);
    expect(hopHeight(HOP_AIR, 6, HOP_AIR)).toBeCloseTo(0, 10);
    expect(hopHeight((HOP_AIR + 1) / 2, 6, HOP_AIR)).toBe(0); // sitting
    expect(hopHeight(6, 6, HOP_AIR)).toBe(0);
    expect(hopHeight(9, 6, HOP_AIR)).toBe(0);
  });

  it("rises and falls without a step", () => {
    for (let k = 0; k < 6; k++) {
      for (const edge of [k, k + HOP_AIR]) {
        expect(Math.abs(hopHeight(edge + 1e-9, 6, HOP_AIR) - hopHeight(edge - 1e-9, 6, HOP_AIR))).toBeLessThan(1e-6);
      }
    }
  });
});

describe("landings and thocks", () => {
  it("counts every landing of a forward walk, at touchdown", () => {
    expect(landingsBy(0, 6, false, HOP_AIR)).toBe(0);
    expect(landingsBy(HOP_AIR - 1e-6, 6, false, HOP_AIR)).toBe(0);
    expect(landingsBy(HOP_AIR, 6, false, HOP_AIR)).toBe(1);
    expect(landingsBy(1, 6, false, HOP_AIR)).toBe(1);
    expect(landingsBy(5 + HOP_AIR, 6, false, HOP_AIR)).toBe(6);
    expect(landingsBy(9, 6, false, HOP_AIR)).toBe(6);
  });

  it("with no pause, lands exactly on the whole cells", () => {
    expect(landingsBy(0.999, 6, false, 1)).toBe(0);
    expect(landingsBy(1, 6, false, 1)).toBe(1);
    expect(landingsBy(6, 6, false, 1)).toBe(6);
  });

  it("counts only the arrival on a retrace", () => {
    expect(landingsBy(5.99, 6, true, 1)).toBe(0);
    expect(landingsBy(6, 6, true, 1)).toBe(1);
  });

  it("asks for each hop's sound the lead ahead of its point in the jump", () => {
    // Heard from the top of the jump, so the clip's falling pitch rides the
    // fall down to the landing.
    const lead = 0.2;
    const first = HOP_AIR * HOP_SOUND_AT - lead;
    expect(cuesBy(first - 1e-6, 6, false, lead, HOP_AIR)).toBe(0);
    expect(cuesBy(first, 6, false, lead, HOP_AIR)).toBe(1);
    expect(cuesBy(5 + first, 6, false, lead, HOP_AIR)).toBe(6);
    expect(cuesBy(6, 6, false, lead, HOP_AIR)).toBe(6);
  });

  it("puts the hop's sound on the fall, before the landing it belongs to", () => {
    for (let k = 1; k <= 6; k++) {
      const heard = k - 1 + HOP_AIR * HOP_SOUND_AT; // with zero lead, heard = asked
      expect(heard).toBeGreaterThan(k - 1); // after take-off
      expect(heard).toBeLessThan(k - 1 + HOP_AIR); // before touchdown
      expect(cuesBy(heard, 6, false, 0, HOP_AIR)).toBe(k);
    }
  });

  it("has the first sound due at once when the lead outruns the run-up", () => {
    // Without a pre-roll (before the delay is measured), a lead longer than the
    // run-up makes the first sound due from the very first frame. Board must
    // still play it — it counts what it has played rather than waiting for this
    // to change.
    expect(cuesBy(0, 6, false, 0.8, HOP_AIR)).toBe(1);
  });

  it("with a pre-roll, sounds the first hop at the clock's start and every hop on its beat", () => {
    // A long delay: the lead outruns the first hop, so the clock starts at -p
    // (the pre-roll, in steps). Asked at the start, the first sound is heard
    // exactly at the first apex; every later one is asked for its own lead early.
    const lead = 1.2; // 1.2 steps of delay
    const p = lead - HOP_AIR * HOP_SOUND_AT;
    expect(cuesBy(-p, 6, false, lead, HOP_AIR)).toBe(1);
    expect(cuesBy(-p - 1e-6, 6, false, lead, HOP_AIR)).toBe(0);
    for (let k = 2; k <= 6; k++) {
      const askedAt = k - 1 + HOP_AIR * HOP_SOUND_AT - lead;
      expect(cuesBy(askedAt - 1e-6, 6, false, lead, HOP_AIR)).toBe(k - 1);
      expect(cuesBy(askedAt, 6, false, lead, HOP_AIR)).toBe(k);
    }
  });

  it("asks for a retrace's single thock the lead ahead of its arrival", () => {
    const lead = 3; // 90ms of a 30ms scurry step
    expect(cuesBy(2.99, 6, true, lead, 1)).toBe(0);
    expect(cuesBy(3, 6, true, lead, 1)).toBe(1);
  });

  it("lands every hop within one frame of its beat, however long the walk (no drift)", () => {
    // Sample the clock the way a 60Hz display does, from several phases. Each
    // touchdown is seen on the first frame at or after its beat — never later,
    // and the error does not grow with the cell count.
    const stepMs = 150;
    const frameMs = 1000 / 60;
    const cells = 6;
    for (let phase = 0; phase < frameMs; phase += frameMs / 7) {
      let seen = 0;
      for (let now = phase; seen < cells; now += frameMs) {
        const t = now / stepMs;
        const landed = landingsBy(t, cells, false, HOP_AIR);
        while (seen < landed) {
          seen++;
          const late = now - (seen - 1 + HOP_AIR) * stepMs;
          expect(late).toBeGreaterThanOrEqual(-1e-9);
          expect(late).toBeLessThan(frameMs);
        }
      }
    }
  });
});
