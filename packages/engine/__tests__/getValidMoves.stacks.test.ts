/**
 * Stack protection (`rules.protectStacks`): two or more of a player's tokens on
 * one cell guard each other. Landing on such a stack is illegal; passing over
 * it is not — that is the difference between this and a full blockade.
 */

import { describe, it, expect } from "vitest";
import { getValidMoves } from "../src/index.js";
import { fourPlayerGame, twoPlayerGame, withDice, withToken } from "./helpers.js";

/** Red's move for `tokenId` with the current dice, or undefined if illegal. */
const moveFor = (state: ReturnType<typeof twoPlayerGame>, tokenId: string) =>
  getValidMoves(state, "p1").find((m) => m.tokenId === tokenId);

describe("getValidMoves — protected stacks", () => {
  it("refuses to land on a stack of two opponent tokens", () => {
    let state = twoPlayerGame();
    state = withToken(state, "yellow-0", { type: "track", index: 5 });
    state = withToken(state, "yellow-1", { type: "track", index: 5 });
    state = withToken(state, "red-0", { type: "track", index: 3 });
    state = withDice(state, 2);

    expect(moveFor(state, "red-0")).toBeUndefined();
  });

  it("still captures a lone opponent token", () => {
    let state = twoPlayerGame();
    state = withToken(state, "yellow-0", { type: "track", index: 5 });
    state = withToken(state, "red-0", { type: "track", index: 3 });
    state = withDice(state, 2);

    expect(moveFor(state, "red-0")?.captures).toEqual(["yellow-0"]);
  });

  it("lets a token pass straight over a stack", () => {
    let state = twoPlayerGame();
    state = withToken(state, "yellow-0", { type: "track", index: 5 });
    state = withToken(state, "yellow-1", { type: "track", index: 5 });
    state = withToken(state, "red-0", { type: "track", index: 3 });
    state = withDice(state, 4); // 3 -> 7, over the stack on 5

    expect(moveFor(state, "red-0")?.to).toEqual({ type: "track", index: 7 });
  });

  it("captures both when two DIFFERENT opponents share a cell (not a stack)", () => {
    let state = fourPlayerGame();
    state = withToken(state, "green-0", { type: "track", index: 5 });
    state = withToken(state, "yellow-0", { type: "track", index: 5 });
    state = withToken(state, "red-0", { type: "track", index: 3 });
    state = withDice(state, 2);

    const move = getValidMoves(state, "p1").find((m) => m.tokenId === "red-0");
    expect(move?.captures).toHaveLength(2);
    expect(move?.captures).toEqual(expect.arrayContaining(["green-0", "yellow-0"]));
  });

  it("allows landing on a stack parked on a safe square, without capturing", () => {
    let state = twoPlayerGame();
    state = withToken(state, "yellow-0", { type: "track", index: 8 }); // starred
    state = withToken(state, "yellow-1", { type: "track", index: 8 });
    state = withToken(state, "red-0", { type: "track", index: 6 });
    state = withDice(state, 2);

    const move = moveFor(state, "red-0");
    expect(move?.to).toEqual({ type: "track", index: 8 });
    expect(move?.captures).toEqual([]);
  });

  it("never blocks a player from stacking their own tokens", () => {
    let state = twoPlayerGame();
    state = withToken(state, "red-0", { type: "track", index: 5 });
    state = withToken(state, "red-1", { type: "track", index: 5 });
    state = withToken(state, "red-2", { type: "track", index: 3 });
    state = withDice(state, 2);

    expect(moveFor(state, "red-2")?.to).toEqual({ type: "track", index: 5 });
  });

  it("is off when the rule is disabled — the stack is capturable again", () => {
    let state = twoPlayerGame();
    state = withToken(state, "yellow-0", { type: "track", index: 5 });
    state = withToken(state, "yellow-1", { type: "track", index: 5 });
    state = withToken(state, "red-0", { type: "track", index: 3 });
    state = withDice(state, 2);
    state = { ...state, rules: { ...state.rules, protectStacks: false } };

    expect(moveFor(state, "red-0")?.captures).toHaveLength(2);
  });
});
