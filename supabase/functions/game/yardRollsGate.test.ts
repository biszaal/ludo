/**
 * Which tables may be dealt with the three-roll rule on.
 *
 * `threeRollsFromYard` lives in the ENGINE, and the engine is dual-deployed:
 * the client predicts every turn with it and the server decides with it. A seat
 * on an older build predicts the turn passing on its first dud roll from a full
 * yard, watches the server keep the turn instead, and snaps back — on every
 * such turn, for the whole match. There is no OTA channel, so that seat can
 * never be fixed; the only safe answer is to deal its table with the rule off.
 *
 * Same shape and same reasoning as the fold gate (seatVersion.test.ts), and the
 * two are checked together at deal time off one read of the seats.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { yardRollsAllowed, YARD_ROLLS_MIN_VERSION } from "./lib.ts";

const seat = (user_id: string, app_version: string | null) => ({ user_id, app_version });
const NO_BOTS = new Set<string>();

Deno.test("every human seat on the new build allows the rule", () => {
  assertEquals(
    yardRollsAllowed([seat("a", YARD_ROLLS_MIN_VERSION), seat("b", YARD_ROLLS_MIN_VERSION)], NO_BOTS),
    true,
  );
});

Deno.test("a later build is new enough too", () => {
  assertEquals(yardRollsAllowed([seat("a", "1.1.0"), seat("b", "2.0.0")], NO_BOTS), true);
});

Deno.test("one old seat turns the rule off for the whole table", () => {
  // The rule has to be the same for everyone: a table where one player gets
  // three rolls and another predicts one is not a game, it is a desync.
  assertEquals(yardRollsAllowed([seat("a", "1.0.4"), seat("b", "1.0.3")], NO_BOTS), false);
});

Deno.test("a seat that reported no version at all is old", () => {
  // Every 1.0.1 binary in the wild sends no appVersion. Absent means old.
  assertEquals(yardRollsAllowed([seat("a", "1.0.4"), seat("b", null)], NO_BOTS), false);
});

Deno.test("bot seats are exempt — they have no client to mispredict with", () => {
  const bots = new Set(["bot"]);
  assertEquals(yardRollsAllowed([seat("a", "1.0.4"), seat("bot", null)], bots), true);
});

Deno.test("an empty table is not dealt with the rule", () => {
  assertEquals(yardRollsAllowed([], NO_BOTS), false);
});
