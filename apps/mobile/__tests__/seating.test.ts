/**
 * Who sits where, and in which pawns.
 *
 * Two properties matter to players and neither is obvious from the code:
 *
 *   - seat i and seat i+2 face each other across the board, which is what makes
 *     "the two humans sit on the diagonal" (friend rooms with bot fill) a thing
 *     the seating can express at all;
 *   - the colors rotate per game, so opening a room stops meaning "you're red".
 *
 * The vectors below are duplicated verbatim in supabase/functions/game's
 * seating test. That duplication is the point: the client previews the deal in
 * the lobby and the server performs it, from two copies of this function, and
 * the moment they disagree the lobby starts promising pawns nobody receives.
 */

import { describe, expect, it } from "vitest";
import { colorOffset, seatColors } from "@ludo/engine";

/** Board geometry: the pairs that sit opposite each other, not side by side. */
const DIAGONALS = [
  ["red", "yellow"],
  ["green", "blue"],
];

function isDiagonalPair(a: string, b: string): boolean {
  return DIAGONALS.some((pair) => pair.includes(a) && pair.includes(b));
}

/** Ids ending in each hex digit, to walk every rotation the offset can produce. */
function idEndingIn(hex: string): string {
  return `11111111-2222-3333-4444-55555555555${hex}`;
}

describe("colorOffset", () => {
  it("has no rotation without a game (the pickers' static preview)", () => {
    expect(colorOffset()).toBe(0);
    expect(colorOffset(null)).toBe(0);
    expect(seatColors(4)).toEqual(["red", "green", "yellow", "blue"]);
    expect(seatColors(2)).toEqual(["red", "yellow"]);
  });

  it("spreads evenly over the four rotations across the hex digits", () => {
    const counts = new Map<number, number>();
    for (const hex of "0123456789abcdef") {
      const off = colorOffset(idEndingIn(hex));
      counts.set(off, (counts.get(off) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([0, 1, 2, 3]);
    expect([...counts.values()]).toEqual([4, 4, 4, 4]);
  });

  it("is stable for one game — the lobby and the deal must not disagree", () => {
    const id = idEndingIn("7");
    expect(seatColors(4, id)).toEqual(seatColors(4, id));
  });
});

describe("seatColors", () => {
  it("gives every seat its own color", () => {
    for (const hex of "0123456789abcdef") {
      const colors = seatColors(4, idEndingIn(hex));
      expect(new Set(colors).size).toBe(4);
    }
  });

  it("seats a 2-player table on the diagonal, in every rotation", () => {
    for (const hex of "0123456789abcdef") {
      const [a, b] = seatColors(2, idEndingIn(hex));
      expect(isDiagonalPair(a!, b!)).toBe(true);
    }
  });

  it("puts seats 0 and 2 (and 1 and 3) opposite each other", () => {
    // This is what a friend room leans on when it moves the second human to
    // seat 2 and drops the bots into 1 and 3.
    for (const hex of "0123456789abcdef") {
      const c = seatColors(4, idEndingIn(hex));
      expect(isDiagonalPair(c[0]!, c[2]!)).toBe(true);
      expect(isDiagonalPair(c[1]!, c[3]!)).toBe(true);
    }
  });

  it("keeps turn order running clockwise round the board", () => {
    // Rotating the cycle, never shuffling it: play still goes round the table
    // the way the board is drawn, whichever color starts.
    const clockwise = ["red", "green", "yellow", "blue"];
    for (const hex of "0123456789abcdef") {
      const c = seatColors(4, idEndingIn(hex));
      const from = clockwise.indexOf(c[0]!);
      expect(c).toEqual(clockwise.map((_, i) => clockwise[(from + i) % 4]));
    }
  });

  it("does not always hand the host red", () => {
    const firstSeats = new Set([..."0123456789abcdef"].map((hex) => seatColors(4, idEndingIn(hex))[0]));
    expect(firstSeats.size).toBe(4);
  });

  it("fills a 3-player table with three consecutive seats", () => {
    const four = seatColors(4, idEndingIn("b"));
    expect(seatColors(3, idEndingIn("b"))).toEqual(four.slice(0, 3));
  });
});
