import { describe, it, expect } from "vitest";
import { applyMove, endTurn, getValidMoves } from "../src/index.js";
import { twoPlayerGame, withToken, withDice } from "./helpers.js";

describe("applyMove — turn flow", () => {
  it("hands off after an ordinary move", () => {
    let state = withToken(twoPlayerGame(), "red-0", { type: "track", index: 3 });
    state = withDice(state, 2);
    const next = applyMove(state, { tokenId: "red-0" });
    expect(next.currentTurnPlayerId).toBe("p2");
    expect(next.phase).toBe("awaiting-roll");
  });

  it("grants a bonus turn on a six and preserves the six-streak", () => {
    let state = withToken(twoPlayerGame(), "red-0", { type: "track", index: 3 });
    state = { ...withDice(state, 6), consecutiveSixes: 1 };
    const next = applyMove(state, { tokenId: "red-0" });
    expect(next.currentTurnPlayerId).toBe("p1");
    expect(next.phase).toBe("awaiting-roll");
    expect(next.consecutiveSixes).toBe(1);
  });

  it("grants a bonus turn on finishing a token", () => {
    let state = withToken(twoPlayerGame(), "red-0", { type: "homePath", index: 2 });
    state = withDice(state, 3); // exact roll into the center
    const next = applyMove(state, { tokenId: "red-0" });
    expect(next.tokens.find((t) => t.id === "red-0")!.position).toBe("finished");
    expect(next.currentTurnPlayerId).toBe("p1");
  });

  it("throws on an illegal move", () => {
    const state = withDice(twoPlayerGame(), 3); // yard tokens can't move on a 3
    expect(() => applyMove(state, { tokenId: "red-0" })).toThrow();
  });

  it("ignores a tampered destination and uses the engine's resolution", () => {
    let state = withToken(twoPlayerGame(), "red-0", { type: "track", index: 3 });
    state = withDice(state, 2);
    // Caller only supplies tokenId; engine recomputes the destination.
    const next = applyMove(state, { tokenId: "red-0" });
    expect(next.tokens.find((t) => t.id === "red-0")!.position).toEqual({ type: "track", index: 5 });
  });

  it("declares a winner once all four tokens finish", () => {
    let state = twoPlayerGame();
    state = withToken(state, "red-0", "finished");
    state = withToken(state, "red-1", "finished");
    state = withToken(state, "red-2", "finished");
    state = withToken(state, "red-3", { type: "homePath", index: 2 });
    state = withDice(state, 3);

    const next = applyMove(state, { tokenId: "red-3" });
    expect(next.status).toBe("finished");
    expect(next.winnerPlayerId).toBe("p1");
  });
});

describe("endTurn", () => {
  it("passes the turn when there are no legal moves", () => {
    const state = withDice(twoPlayerGame(), 3); // all yarded, can't move
    expect(getValidMoves(state, "p1")).toEqual([]);
    const next = endTurn(state);
    expect(next.currentTurnPlayerId).toBe("p2");
    expect(next.phase).toBe("awaiting-roll");
  });

  it("refuses to pass when a legal move exists", () => {
    const state = withDice(twoPlayerGame(), 6); // yard tokens can leave
    expect(() => endTurn(state)).toThrow();
  });

  it("refuses to pass before rolling", () => {
    expect(() => endTurn(twoPlayerGame())).toThrow();
  });
});
