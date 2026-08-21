/**
 * Deno tests for the seating rules the deal performs.
 *
 * The vectors here are duplicated verbatim in apps/mobile/__tests__/seating.ts.
 * That is deliberate: the lobby PREVIEWS this deal from its own copy of the
 * function, and the two agreeing is the whole reason the preview can promise a
 * color at all. Break one and this pins which side moved.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AWAY_TURN_SECONDS, colorOffset, seatColor, seatColors, turnDeadline, TURN_SECONDS, turnHolder } from "./lib.ts";
// @deno-types="../_shared/engine/index.d.ts"
import { createGame } from "../_shared/engine/index.js";

/** Board geometry: the pairs that sit opposite each other, not side by side. */
const DIAGONALS = [
  ["red", "yellow"],
  ["green", "blue"],
];
const HEX = "0123456789abcdef";

function isDiagonalPair(a: string, b: string): boolean {
  return DIAGONALS.some((pair) => pair.includes(a) && pair.includes(b));
}

function idEndingIn(hex: string): string {
  return `11111111-2222-3333-4444-55555555555${hex}`;
}

Deno.test("no game id means no rotation — the pickers' static preview", () => {
  assertEquals(colorOffset(), 0);
  assertEquals(seatColors(4), ["red", "green", "yellow", "blue"]);
  assertEquals(seatColors(2), ["red", "yellow"]);
});

Deno.test("the rotation spreads evenly over the hex digits", () => {
  const counts = new Map<number, number>();
  for (const hex of HEX) counts.set(colorOffset(idEndingIn(hex)), (counts.get(colorOffset(idEndingIn(hex))) ?? 0) + 1);
  assertEquals([...counts.keys()].sort(), [0, 1, 2, 3]);
  assertEquals([...counts.values()], [4, 4, 4, 4]);
});

Deno.test("every seat gets its own color — players carries unique (game_id, color)", () => {
  for (const hex of HEX) assertEquals(new Set(seatColors(4, idEndingIn(hex))).size, 4);
});

Deno.test("a 2-player table sits on the diagonal in every rotation", () => {
  for (const hex of HEX) {
    const [a, b] = seatColors(2, idEndingIn(hex));
    assertEquals(isDiagonalPair(a!, b!), true);
  }
});

Deno.test("seats 0/2 and 1/3 face each other — what the bot fill relies on", () => {
  for (const hex of HEX) {
    const c = seatColors(4, idEndingIn(hex));
    assertEquals(isDiagonalPair(c[0]!, c[2]!), true);
    assertEquals(isDiagonalPair(c[1]!, c[3]!), true);
  }
});

Deno.test("turn order still runs clockwise round the board", () => {
  const clockwise = ["red", "green", "yellow", "blue"];
  for (const hex of HEX) {
    const c = seatColors(4, idEndingIn(hex));
    const from = clockwise.indexOf(c[0]!);
    assertEquals(c, clockwise.map((_, i) => clockwise[(from + i) % 4]));
  }
});

Deno.test("the host is not red every time", () => {
  assertEquals(new Set([...HEX].map((hex) => seatColors(4, idEndingIn(hex))[0])).size, 4);
});

Deno.test("seatColor (a filling room) agrees with seatColors (the deal)", () => {
  // The lobby writes one seat at a time as people join; the deal re-reads them
  // all at once. Disagreeing would collide on unique (game_id, color).
  for (const hex of HEX) {
    const id = idEndingIn(hex);
    assertEquals([0, 1, 2, 3].map((seat) => seatColor(seat, id)), seatColors(4, id));
  }
});

Deno.test("an away seat's clock is materially shorter than a present one's", () => {
  const state = createGame(
    [
      { id: "p1", userId: "u1", color: "red" },
      { id: "p2", userId: "u2", color: "yellow" },
    ],
    { gameId: idEndingIn("0") },
  );
  const full = Date.parse(turnDeadline(state)!) - Date.now();
  const away = Date.parse(turnDeadline(state, AWAY_TURN_SECONDS)!) - Date.now();
  assertEquals(Math.round(full / 1000), TURN_SECONDS);
  assertEquals(Math.round(away / 1000), AWAY_TURN_SECONDS);
  assertEquals(away < full, true);
  // A finished game has no clock at all, whichever length is asked for.
  const over = { ...state, status: "finished" as const };
  assertEquals(turnDeadline(over, AWAY_TURN_SECONDS), null);
  assertEquals(turnHolder(over), null);
  assertEquals(turnHolder(state), "u1");
});
