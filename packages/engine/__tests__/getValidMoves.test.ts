import { describe, it, expect } from "vitest";
import { getValidMoves } from "../src/index.js";
import { twoPlayerGame, withToken, withDice } from "./helpers.js";

describe("getValidMoves", () => {
  it("returns nothing before a dice is rolled", () => {
    expect(getValidMoves(twoPlayerGame(), "p1")).toEqual([]);
  });

  it("returns nothing for a player who is not on the clock", () => {
    const state = withDice(twoPlayerGame(), 6);
    expect(getValidMoves(state, "p2")).toEqual([]);
  });

  it("lets every yard token leave on a 6, all onto the start cell", () => {
    const state = withDice(twoPlayerGame(), 6);
    const moves = getValidMoves(state, "p1");
    expect(moves).toHaveLength(4);
    expect(moves.every((m) => JSON.stringify(m.to) === JSON.stringify({ type: "track", index: 0 }))).toBe(true);
    expect(moves.every((m) => m.captures.length === 0)).toBe(true);
  });

  it("keeps yard tokens stuck without a 6", () => {
    const state = withDice(twoPlayerGame(), 3);
    expect(getValidMoves(state, "p1")).toEqual([]);
  });

  it("requires an exact roll to finish and forbids overshoot", () => {
    // red token in its home column, two cells from the center (relIndex 53).
    let state = withToken(twoPlayerGame(), "red-0", { type: "homePath", index: 2 });

    const exact = getValidMoves(withDice(state, 3), "p1").find((m) => m.tokenId === "red-0");
    expect(exact?.to).toBe("finished");
    expect(exact?.finishes).toBe(true);

    const overshoot = getValidMoves(withDice(state, 4), "p1").find((m) => m.tokenId === "red-0");
    expect(overshoot).toBeUndefined();
  });

  it("finishes a token that reaches the center exactly from the track", () => {
    // red relIndex 50 (absolute 50) + 6 = relIndex 56 = finished.
    const state = withToken(twoPlayerGame(), "red-0", { type: "track", index: 50 });
    const move = getValidMoves(withDice(state, 6), "p1").find((m) => m.tokenId === "red-0");
    expect(move?.finishes).toBe(true);
  });

  it("captures a lone opponent on a non-safe cell", () => {
    let state = twoPlayerGame();
    state = withToken(state, "yellow-0", { type: "track", index: 5 }); // not safe
    state = withToken(state, "red-0", { type: "track", index: 3 });
    const move = getValidMoves(withDice(state, 2), "p1").find((m) => m.tokenId === "red-0");
    expect(move?.to).toEqual({ type: "track", index: 5 });
    expect(move?.captures).toEqual(["yellow-0"]);
  });

  it("does not capture on a safe (starred) square", () => {
    let state = twoPlayerGame();
    state = withToken(state, "yellow-0", { type: "track", index: 8 }); // safe star
    state = withToken(state, "red-0", { type: "track", index: 6 });
    const move = getValidMoves(withDice(state, 2), "p1").find((m) => m.tokenId === "red-0");
    expect(move?.to).toEqual({ type: "track", index: 8 });
    expect(move?.captures).toEqual([]);
  });

  it("never captures the moving player's own tokens", () => {
    let state = twoPlayerGame();
    state = withToken(state, "red-1", { type: "track", index: 5 });
    state = withToken(state, "red-0", { type: "track", index: 3 });
    const move = getValidMoves(withDice(state, 2), "p1").find((m) => m.tokenId === "red-0");
    expect(move?.captures).toEqual([]);
  });
});
