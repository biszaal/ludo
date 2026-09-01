/**
 * The dry-turn rescue: what it does, and what it must never do.
 *
 * This is a deliberate thumb on the scale — after enough turns with no six and
 * no legal move, the die becomes more likely to come up six. It is the one
 * place the game does not deal straight, so the properties that keep it
 * defensible are worth pinning harder than the odds themselves.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deriveDie, dryBoost, dryTurnsFor, nextDryTurns, DRY_TURNS_THRESHOLD } from "./lib.ts";

const GAME = "22222222-2222-2222-2222-222222222222";
const SEAT = "33333333-3333-3333-3333-333333333333";

Deno.test("no help at all below the threshold", () => {
  for (let n = 0; n < DRY_TURNS_THRESHOLD; n++) assertEquals(dryBoost(n), 0);
});

Deno.test("help starts at the threshold and grows", () => {
  const at = dryBoost(DRY_TURNS_THRESHOLD);
  const later = dryBoost(DRY_TURNS_THRESHOLD + 2);
  assertEquals(at > 0, true);
  assertEquals(later > at, true);
});

Deno.test("help climbs to certainty and stops there", () => {
  // It DOES reach a guaranteed six, and the reasoning is on DRY_STEP: a rescue
  // is only "plannable" if knowing it is coming lets you play differently, and
  // the counter only advances on turns with no legal move at all — so there is
  // nothing to plan with. What must stay true is the shape: monotonic, and never
  // past 1, because dryBoost is compared against a unit interval.
  let prev = 0;
  for (let n = DRY_TURNS_THRESHOLD; n <= DRY_TURNS_THRESHOLD + 8; n++) {
    const b = dryBoost(n);
    assertEquals(b >= prev, true);
    assertEquals(b <= 1, true);
    prev = b;
  }
  assertEquals(dryBoost(DRY_TURNS_THRESHOLD + 2), 1);
  // Past the ceiling it is flat, not growing — an unbounded boost would be a
  // probability greater than one, which the comparison in deriveDie would read
  // as "always", but only by accident.
  assertEquals(dryBoost(500), 1);
  assertEquals(dryBoost(50), dryBoost(500));
});

Deno.test("a seat stuck long enough is certainly freed", async () => {
  // The whole point of the retune. At the certainty rung the derivation must
  // return a six for every seat, not merely usually.
  for (const seat of [SEAT, "44444444-4444-4444-4444-444444444444", "another-seat"]) {
    for (let v = 0; v < 12; v++) {
      const die = await deriveDie(GAME, v, seat, DRY_TURNS_THRESHOLD + 2);
      if (die === null) return; // no DICE_SECRET configured — nothing to bias
      assertEquals(die, 6);
    }
  }
});

Deno.test("a negative or absent count is simply no help", () => {
  assertEquals(dryBoost(0), 0);
  assertEquals(dryBoost(-3), 0);
});

Deno.test("a die is always a die, however much help is applied", async () => {
  // Whatever the bias does, it must never produce something that is not a face.
  for (const dry of [0, DRY_TURNS_THRESHOLD, 99]) {
    const die = await deriveDie(GAME, 3, SEAT, dry);
    if (die === null) continue; // no DICE_SECRET configured — nothing to bias
    assertEquals(die >= 1 && die <= 6, true);
    assertEquals(Number.isInteger(die), true);
  }
});

Deno.test("a stuck roll advances only that seat", () => {
  const before = { [SEAT]: 2, other: 5 };
  const after = nextDryTurns(before, SEAT, true);
  assertEquals(dryTurnsFor(after, SEAT), 3);
  assertEquals(dryTurnsFor(after, "other"), 5);
  // Pure: the stored map is untouched, so a write that loses the version race
  // cannot have moved anything.
  assertEquals(dryTurnsFor(before, SEAT), 2);
});

Deno.test("any roll that achieved something resets the streak", () => {
  const after = nextDryTurns({ [SEAT]: 9 }, SEAT, false);
  assertEquals(dryTurnsFor(after, SEAT), 0);
  // Dropped rather than stored as 0, so the common case is an empty map.
  assertEquals(Object.prototype.hasOwnProperty.call(after, SEAT), false);
});

Deno.test("a missing or malformed map is simply no help", () => {
  // A database whose migration has not landed yet lands here, which is what
  // makes the edge deploy safe to ship in either order.
  assertEquals(dryTurnsFor(undefined, SEAT), 0);
  assertEquals(dryTurnsFor(null, SEAT), 0);
  assertEquals(dryTurnsFor("nonsense", SEAT), 0);
  assertEquals(dryTurnsFor({ [SEAT]: -4 }, SEAT), 0);
  assertEquals(dryTurnsFor({}, SEAT), 0);
  assertEquals(dryTurnsFor({ [SEAT]: 3 }, "someone-else"), 0);
});

Deno.test("counting from nothing starts at one", () => {
  assertEquals(dryTurnsFor(nextDryTurns({}, SEAT, true), SEAT), 1);
});

Deno.test("the same inputs always give the same die", async () => {
  // The anti-stalling property: a player shown a bad die who declines to roll
  // must get that same die when the bot plays their seat. A rescue drawn from
  // fresh randomness would hand that exploit back.
  const a = await deriveDie(GAME, 7, SEAT, 9);
  const b = await deriveDie(GAME, 7, SEAT, 9);
  assertEquals(a, b);
});
