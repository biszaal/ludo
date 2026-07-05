import { describe, it, expect } from "vitest";
import {
  applyMove,
  createGame,
  createSeededRng,
  endTurn,
  getValidMoves,
  rollDice,
  type GameState,
  type TokenPosition,
} from "@ludo/engine";
import { chooseMove } from "../src/index.js";

function game2(): GameState {
  return createGame(
    [
      { id: "p1", userId: "u1", color: "red" },
      { id: "p2", userId: "u2", color: "yellow" },
    ],
    { gameId: "g" },
  );
}

function withToken(state: GameState, tokenId: string, position: TokenPosition): GameState {
  return { ...state, tokens: state.tokens.map((t) => (t.id === tokenId ? { ...t, position } : t)) };
}

function withDice(state: GameState, diceValue: number): GameState {
  return { ...state, phase: "awaiting-move", diceValue };
}

function movesFor(state: GameState) {
  return getValidMoves(state, "p1");
}

describe("chooseMove", () => {
  it("returns the only move when there is just one", () => {
    let state = withToken(game2(), "red-0", { type: "track", index: 3 });
    state = withDice(state, 2);
    const moves = movesFor(state);
    expect(moves).toHaveLength(1);
    expect(chooseMove(state, "p1", moves).tokenId).toBe("red-0");
  });

  it("prefers a capturing move over a plain advance", () => {
    let state = game2();
    state = withToken(state, "red-0", { type: "track", index: 3 });
    state = withToken(state, "red-1", { type: "track", index: 10 });
    state = withToken(state, "yellow-0", { type: "track", index: 5 }); // capturable
    state = withDice(state, 2);
    expect(chooseMove(state, "p1", movesFor(state)).tokenId).toBe("red-0");
  });

  it("prefers finishing a token over advancing another", () => {
    let state = game2();
    state = withToken(state, "red-0", { type: "homePath", index: 2 }); // 3 finishes it
    state = withToken(state, "red-1", { type: "track", index: 10 });
    state = withDice(state, 3);
    const move = chooseMove(state, "p1", movesFor(state));
    expect(move.tokenId).toBe("red-0");
    expect(move.finishes).toBe(true);
  });

  it("advances the token closest to finishing", () => {
    let state = game2();
    state = withToken(state, "red-0", { type: "track", index: 30 }); // more advanced
    state = withToken(state, "red-1", { type: "track", index: 5 });
    state = withDice(state, 2);
    expect(chooseMove(state, "p1", movesFor(state)).tokenId).toBe("red-0");
  });

  it("leaves the yard when that is all it can do", () => {
    const state = withDice(game2(), 6); // all red tokens yarded
    const move = chooseMove(state, "p1", movesFor(state));
    expect(move.from).toBe("home");
  });

  it("breaks ties deterministically for a given rng", () => {
    const state = withDice(game2(), 6);
    const moves = movesFor(state);
    const a = chooseMove(state, "p1", moves, { rng: createSeededRng(11) });
    const b = chooseMove(state, "p1", moves, { rng: createSeededRng(11) });
    expect(a.tokenId).toBe(b.tokenId);
  });

  it("throws when asked to choose with no moves", () => {
    expect(() => chooseMove(game2(), "p1", [])).toThrow();
  });
});

describe("bot vs bot", () => {
  it.each([1, 8, 64])("plays a full game to completion (seed %i)", (seed) => {
    let state = createGame(
      [
        { id: "p1", userId: "u1", color: "red" },
        { id: "p2", userId: "u2", color: "blue" },
      ],
      { gameId: `bot-${seed}` },
    );
    const rng = createSeededRng(seed);

    for (let steps = 0; steps < 200_000 && state.status === "active"; steps++) {
      if (state.phase === "awaiting-roll") {
        state = rollDice(state, rng).newState;
      } else {
        const moves = getValidMoves(state, state.currentTurnPlayerId);
        state = moves.length === 0 ? endTurn(state) : applyMove(state, chooseMove(state, state.currentTurnPlayerId, moves, { rng }));
      }
    }
    expect(state.status).toBe("finished");
  });
});
