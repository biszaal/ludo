/**
 * Three rolls to leave the yard.
 *
 * With `leaveYardOnSix` on, a player whose tokens are all in the yard can do
 * nothing at all without a six, and P(no six in n rolls) is (5/6)^n: 58% still
 * stuck after three turns, 33% after six, 16% after ten. Against a turn clock
 * and three opponents that is minutes of watching other people play — the most
 * common complaint the game gets, and the reason "just give them a six" keeps
 * being suggested.
 *
 * A guaranteed six is the wrong shape of fix for a game with coin stakes: a
 * hidden change to the dice distribution is exploitable by anyone who works out
 * the counter, and indefensible if it is ever datamined. This is the standard
 * Ludo answer instead — the one Ludo King and most implementations ship, and
 * the one players already expect. It is a RULE, not a rig: public, symmetric,
 * printed in How to Play, and it moves "still stuck after five turns" from 40%
 * to 6.5% without touching a single die's odds.
 *
 * The rule only fires where the frustration actually is: nothing on the board
 * and nothing a roll could do. A player with a token in play has moves to make
 * and is not stuck.
 */

import { describe, it, expect } from "vitest";
import { createGame } from "../src/createGame.js";
import { rollDice } from "../src/rollDice.js";
import { endTurn } from "../src/endTurn.js";
import { getValidMoves } from "../src/getValidMoves.js";
import { fromRelativeIndex } from "../src/board.js";
import type { GameState } from "../src/types.js";

// FOUR seats on purpose. With two, a hand-off returns to the same player after
// an even number of turns, so "granted another roll" and "went all the way
// round" are indistinguishable — a two-player version of these tests passes
// against the unfixed engine.
const P1 = { id: "p1", userId: "u1", color: "red" as const };
const P2 = { id: "p2", userId: "u2", color: "green" as const };
const P3 = { id: "p3", userId: "u3", color: "yellow" as const };
const P4 = { id: "p4", userId: "u4", color: "blue" as const };

const game = (): GameState => createGame([P1, P2, P3, P4], { gameId: "g1" });

/** Roll a value that cannot leave the yard, then take the forced pass. */
function rollDud(state: GameState, value = 3): GameState {
  const rolled = rollDice(state, () => (value - 0.5) / 6).newState;
  expect(getValidMoves(rolled, rolled.currentTurnPlayerId)).toHaveLength(0);
  return endTurn(rolled);
}

describe("three rolls from a full yard", () => {
  it("hands the roller a second and third roll instead of the turn", () => {
    let s = game();
    expect(s.currentTurnPlayerId).toBe("p1");

    s = rollDud(s);
    expect(s.currentTurnPlayerId).toBe("p1");
    expect(s.phase).toBe("awaiting-roll");

    s = rollDud(s);
    expect(s.currentTurnPlayerId).toBe("p1");
    expect(s.phase).toBe("awaiting-roll");
  });

  it("gives three rolls and no more", () => {
    let s = game();
    s = rollDud(s);
    s = rollDud(s);
    s = rollDud(s);
    expect(s.currentTurnPlayerId).toBe("p2");
    expect(s.phase).toBe("awaiting-roll");
  });

  it("starts the next player's turn with a fresh count of three", () => {
    let s = game();
    s = rollDud(s);
    s = rollDud(s);
    s = rollDud(s); // p1 is out of rolls -> p2
    expect(s.currentTurnPlayerId).toBe("p2");
    s = rollDud(s);
    s = rollDud(s);
    expect(s.currentTurnPlayerId).toBe("p2");
    s = rollDud(s);
    expect(s.currentTurnPlayerId).toBe("p3");
  });

  it("stops the moment a six actually gets a token out", () => {
    let s = game();
    s = rollDud(s);
    const six = rollDice(s, () => 0.99).newState;
    expect(getValidMoves(six, "p1").length).toBeGreaterThan(0);
    expect(six.currentTurnPlayerId).toBe("p1");
  });

  it("does not apply to a player who has a token on the board", () => {
    // One token in play: this player is not stuck, they simply rolled a number
    // that does not help. The turn passes as it always did.
    let s = game();
    s = {
      ...s,
      tokens: s.tokens.map((t) =>
        t.id === "red-0" ? { ...t, position: fromRelativeIndex("red", 5) } : t,
      ),
    };
    const rolled = rollDice(s, () => (3 - 0.5) / 6).newState;
    // A token in play always has somewhere to go, so this is a real move, not a
    // pass — which is the point: the rule never gets a chance to fire.
    expect(getValidMoves(rolled, "p1").length).toBeGreaterThan(0);
  });

  it("is off when the rule is off — the turn passes on the first dud", () => {
    let s = createGame([P1, P2, P3, P4], { gameId: "g1", rules: { threeRollsFromYard: false } });
    s = rollDud(s);
    expect(s.currentTurnPlayerId).toBe("p2");
  });

  it("counts only rolls, never the pass itself, across a full sweep", () => {
    // Six duds must be exactly two turns of three, not six turns.
    let s = game();
    for (let i = 0; i < 6; i++) s = rollDud(s);
    expect(s.currentTurnPlayerId).toBe("p3");
  });
});
