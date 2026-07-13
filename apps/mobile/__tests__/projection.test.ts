/**
 * Online-view projection — in particular the three-sixes forfeit. The engine
 * clears diceValue and advances the turn inside the same busted roll, so the
 * projection must recover the forfeiting 6 from lastAction or the third six
 * never shows on screen (looking like a forfeit after only two sixes).
 */

import { describe, it, expect } from "vitest";
import { createGame, rollDice, type GameState } from "@ludo/engine";
import { bustedRollDice, project } from "../src/lib/projection";

const PLAYERS = [
  { id: "p1", userId: "u1", color: "red" as const },
  { id: "p2", userId: "u2", color: "yellow" as const },
];

const sixRng = () => 0.99; // rollDie maps this to a 6

/** A real busted state: two sixes already on the streak, then a third rolled. */
function bustedState(): GameState {
  const primed: GameState = { ...createGame(PLAYERS), consecutiveSixes: 2 };
  const { newState, busted } = rollDice(primed, sixRng);
  expect(busted).toBe(true);
  return newState;
}

describe("three-sixes forfeit projection", () => {
  it("recovers the forfeiting 6 from lastAction", () => {
    expect(bustedRollDice(bustedState())).toBe(6);
  });

  it("reads nothing from a normal roll", () => {
    const rolled = rollDice(createGame(PLAYERS), sixRng).newState;
    expect(bustedRollDice(rolled)).toBe(null);
    expect(bustedRollDice(createGame(PLAYERS))).toBe(null);
  });

  it("shows the third six and the forfeit to the player who busted", () => {
    const view = project(bustedState(), "p1"); // turn already passed to p2
    expect(view.lastRoll).toBe(6);
    expect(view.message).toMatch(/three 6s/i);
    expect(view.message).toContain("Yellow");
  });

  it("shows the forfeit to the player receiving the turn", () => {
    const view = project(bustedState(), "p2");
    expect(view.lastRoll).toBe(6);
    expect(view.message).toMatch(/three 6s/i);
    expect(view.message).toMatch(/your turn/i);
  });

  it("keeps the plain messages when nothing busted", () => {
    const rolled = rollDice(createGame(PLAYERS), sixRng).newState; // first six
    expect(project(rolled, "p1").message).toBe("Choose a token");
    expect(project(rolled, "p2").message).toBe("Waiting for Red…");
    expect(project(rolled, "p1").lastRoll).toBe(6);
  });
});
