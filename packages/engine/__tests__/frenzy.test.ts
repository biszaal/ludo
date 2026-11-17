/**
 * Frenzy: no turns. Every seat holds its own die in `state.frenzy.dice`, rolls
 * whenever it is empty, and moves with it; the turn fields go unused. Placement
 * and the end of the game work exactly as in a turn-based game.
 */

import { describe, it, expect } from "vitest";
import {
  applyMove,
  createGame,
  endTurn,
  frenzyPass,
  frenzyRoll,
  getValidMoves,
  rollDice,
  skipTurn,
  type GameState,
} from "../src/index.js";
import { scriptedRng, withToken } from "./helpers.js";

function frenzyGame(count: 2 | 4 = 2): GameState {
  const colors = count === 2 ? (["red", "yellow"] as const) : (["red", "green", "yellow", "blue"] as const);
  return createGame(
    colors.map((color, i) => ({ id: `p${i + 1}`, userId: `u${i + 1}`, color })),
    { gameId: "frenzy", frenzy: true },
  );
}

/** Give one seat a die value without rolling. */
function withDie(state: GameState, playerId: string, value: number | null): GameState {
  return { ...state, frenzy: { dice: { ...state.frenzy!.dice, [playerId]: value } } };
}

describe("frenzy", () => {
  it("starts every seat with an empty die", () => {
    expect(frenzyGame(4).frenzy).toEqual({ dice: { p1: null, p2: null, p3: null, p4: null } });
  });

  it("leaves turn-based states without a frenzy key", () => {
    const classic = createGame([
      { id: "p1", userId: "u1" },
      { id: "p2", userId: "u2" },
    ]);
    expect("frenzy" in classic).toBe(false);
  });

  it("lets every seat roll at the same time", () => {
    let state = frenzyGame();
    state = frenzyRoll(state, "p1", scriptedRng([3])).newState;
    const { newState, diceValue } = frenzyRoll(state, "p2", scriptedRng([5]));

    expect(diceValue).toBe(5);
    expect(newState.frenzy!.dice).toEqual({ p1: 3, p2: 5 });
    expect(newState.lastAction).toMatchObject({ type: "roll", payload: { playerId: "p2", dice: 5 } });
  });

  it("refuses a roll while the seat's die still holds a value", () => {
    const state = withDie(frenzyGame(), "p1", 4);
    expect(() => frenzyRoll(state, "p1", scriptedRng([2]))).toThrow(/already/);
  });

  it("never forfeits on three sixes", () => {
    let state = withToken(frenzyGame(), "red-0", { type: "track", index: 1 });
    for (let i = 0; i < 3; i++) {
      state = frenzyRoll(state, "p1", scriptedRng([6])).newState;
      expect(state.frenzy!.dice.p1).toBe(6);
      state = applyMove(state, { tokenId: "red-0" });
    }
    expect(state.tokens.find((t) => t.id === "red-0")!.position).toEqual({ type: "track", index: 19 });
  });

  it("gives a seat moves from its own die, whoever the turn field names", () => {
    let state = withToken(frenzyGame(), "yellow-0", { type: "track", index: 30 });
    state = withDie(state, "p2", 4);

    expect(state.currentTurnPlayerId).toBe("p1");
    expect(getValidMoves(state, "p2").map((m) => m.tokenId)).toEqual(["yellow-0"]);
    expect(getValidMoves(state, "p1")).toEqual([]); // p1 has not rolled
  });

  it("spends only the mover's die", () => {
    let state = withToken(frenzyGame(), "yellow-0", { type: "track", index: 30 });
    state = withDie(withDie(state, "p1", 2), "p2", 4);

    const next = applyMove(state, { tokenId: "yellow-0" });

    expect(next.tokens.find((t) => t.id === "yellow-0")!.position).toEqual({ type: "track", index: 34 });
    expect(next.frenzy!.dice).toEqual({ p1: 2, p2: null });
    expect(next.lastAction).toMatchObject({ type: "move", payload: { playerId: "p2", bonus: false } });
  });

  it("captures across seats", () => {
    let state = withToken(frenzyGame(), "red-0", { type: "track", index: 33 });
    state = withToken(state, "yellow-0", { type: "track", index: 30 });
    state = withDie(state, "p2", 3);

    const next = applyMove(state, { tokenId: "yellow-0" });

    expect(next.tokens.find((t) => t.id === "red-0")!.position).toBe("home");
    expect(next.lastAction).toMatchObject({ payload: { captures: ["red-0"], bonus: true } });
  });

  it("marks a six as a bonus", () => {
    let state = withToken(frenzyGame(), "red-0", { type: "track", index: 1 });
    state = withDie(state, "p1", 6);
    expect(applyMove(state, { tokenId: "red-0" }).lastAction).toMatchObject({ payload: { bonus: true } });
  });

  it("clears a die with no legal move, and only then", () => {
    const stuck = withDie(frenzyGame(), "p1", 3); // every red token in the yard
    const cleared = frenzyPass(stuck, "p1");
    expect(cleared.frenzy!.dice.p1).toBeNull();
    expect(cleared.lastAction).toMatchObject({ type: "endTurn", payload: { playerId: "p1" } });

    const free = withDie(withToken(frenzyGame(), "red-0", { type: "track", index: 5 }), "p1", 3);
    expect(() => frenzyPass(free, "p1")).toThrow(/legal move/);
  });

  it("places a player who brings every token home and keeps them from rolling", () => {
    let state = frenzyGame(4);
    for (const id of ["red-0", "red-1", "red-2"]) state = withToken(state, id, "finished");
    state = withDie(withToken(state, "red-3", { type: "homePath", index: 4 }), "p1", 1);

    const next = applyMove(state, { tokenId: "red-3" });

    expect(next.finishedOrder).toEqual(["p1"]);
    expect(next.status).toBe("active");
    expect(() => frenzyRoll(next, "p1", scriptedRng([6]))).toThrow(/not in play/);
  });

  it("ends the game when one seat is left racing, clearing every die", () => {
    let state = frenzyGame();
    for (const id of ["red-0", "red-1", "red-2"]) state = withToken(state, id, "finished");
    state = withToken(state, "red-3", { type: "homePath", index: 4 });
    state = withDie(withDie(state, "p1", 1), "p2", 5);

    const next = applyMove(state, { tokenId: "red-3" });

    expect(next.status).toBe("finished");
    expect(next.finishedOrder).toEqual(["p1", "p2"]);
    expect(next.frenzy!.dice).toEqual({ p1: null, p2: null });
  });

  it("rejects the turn-based transitions", () => {
    const state = frenzyGame();
    expect(() => rollDice(state, scriptedRng([2]))).toThrow(/frenzy/i);
    expect(() => endTurn(withDie(state, "p1", 2))).toThrow(/frenzy/i);
    expect(() => skipTurn(state)).toThrow(/frenzy/i);
  });
});
