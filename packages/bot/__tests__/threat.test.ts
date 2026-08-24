/**
 * The bot's model of stack immunity. A cell carrying two or more tokens cannot
 * be captured on, whoever owns them, so it is neither a place to fear nor prey
 * worth chasing — the bot has to read occupancy the same way the engine does.
 */

import { describe, it, expect } from "vitest";
import { createGame, type GameState, type TokenPosition } from "@ludo/engine";
import { captureProb, chaseCount, threatProb } from "../src/threat.js";

function game2(): GameState {
  return createGame(
    [
      { id: "p1", userId: "u1", color: "red" },
      { id: "p2", userId: "u2", color: "yellow" },
    ],
    { gameId: "g" },
  );
}

function game4(): GameState {
  return createGame(
    [
      { id: "p1", userId: "u1", color: "red" },
      { id: "p2", userId: "u2", color: "green" },
      { id: "p3", userId: "u3", color: "yellow" },
      { id: "p4", userId: "u4", color: "blue" },
    ],
    { gameId: "g4" },
  );
}

function withToken(state: GameState, tokenId: string, position: TokenPosition): GameState {
  return { ...state, tokens: state.tokens.map((t) => (t.id === tokenId ? { ...t, position } : t)) };
}

const at = (index: number): TokenPosition => ({ type: "track", index });

describe("threatProb", () => {
  it("is zero for a token sharing its cell with an opponent — two tokens is immune", () => {
    let state = game2();
    state = withToken(state, "red-0", at(5)); // shares cell 5 with yellow-0
    state = withToken(state, "yellow-0", at(5));
    state = withToken(state, "yellow-1", at(2)); // in range of cell 5

    expect(threatProb(state, "p1", at(5))).toBe(0);
  });

  it("still reports a threat to a token standing alone", () => {
    let state = game2();
    state = withToken(state, "red-0", at(5));
    state = withToken(state, "yellow-1", at(2));

    expect(threatProb(state, "p1", at(5))).toBeGreaterThan(0);
  });
});

describe("chaseCount", () => {
  it("does not count prey standing on a crowded cell", () => {
    let state = game4();
    state = withToken(state, "red-0", at(3));
    state = withToken(state, "yellow-0", at(5));
    state = withToken(state, "green-0", at(5)); // two deep — untakeable

    expect(chaseCount(state, "p1", at(3))).toBe(0);
  });

  it("still counts a lone token within reach", () => {
    let state = game4();
    state = withToken(state, "red-0", at(3));
    state = withToken(state, "yellow-0", at(5));

    expect(chaseCount(state, "p1", at(3))).toBe(1);
  });
});

describe("captureProb", () => {
  it("is zero against a victim on a crowded cell", () => {
    let state = game4();
    state = withToken(state, "red-0", at(3)); // hunter in range
    state = withToken(state, "yellow-0", at(5));
    state = withToken(state, "green-0", at(5));

    expect(captureProb(state, "p1", at(5))).toBe(0);
  });

  it("still reports a shot at a lone victim", () => {
    let state = game4();
    state = withToken(state, "red-0", at(3));
    state = withToken(state, "yellow-0", at(5));

    expect(captureProb(state, "p1", at(5))).toBeGreaterThan(0);
  });
});
