/**
 * Stack immunity (`rules.protectStacks`): a cell carrying two or more tokens is
 * immune — nothing on it can be captured, whoever owns the pieces. Landing
 * there is always legal, so a crowded cell keeps growing; it only becomes
 * capturable again once it is back down to a single token.
 *
 * Immunity counts TOKENS, not owners. A stack that decays into one token each
 * from two different players is still two tokens, so it stays immune.
 */

import { describe, it, expect } from "vitest";
import { getValidMoves } from "../src/index.js";
import { fourPlayerGame, twoPlayerGame, withDice, withToken } from "./helpers.js";

/** Red's move for `tokenId` with the current dice, or undefined if illegal. */
const moveFor = (state: ReturnType<typeof twoPlayerGame>, tokenId: string) =>
  getValidMoves(state, "p1").find((m) => m.tokenId === tokenId);

describe("getValidMoves — stack immunity", () => {
  it("lands on a stack of two opponent tokens instead of being barred", () => {
    let state = twoPlayerGame();
    state = withToken(state, "yellow-0", { type: "track", index: 5 });
    state = withToken(state, "yellow-1", { type: "track", index: 5 });
    state = withToken(state, "red-0", { type: "track", index: 3 });
    state = withDice(state, 2);

    expect(moveFor(state, "red-0")?.to).toEqual({ type: "track", index: 5 });
  });

  it("captures nothing when joining an opponent's stack", () => {
    let state = twoPlayerGame();
    state = withToken(state, "yellow-0", { type: "track", index: 5 });
    state = withToken(state, "yellow-1", { type: "track", index: 5 });
    state = withToken(state, "red-0", { type: "track", index: 3 });
    state = withDice(state, 2);

    expect(moveFor(state, "red-0")?.captures).toEqual([]);
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

  it("captures neither when two DIFFERENT opponents share a cell — two tokens is immune", () => {
    let state = fourPlayerGame();
    state = withToken(state, "green-0", { type: "track", index: 5 });
    state = withToken(state, "yellow-0", { type: "track", index: 5 });
    state = withToken(state, "red-0", { type: "track", index: 3 });
    state = withDice(state, 2);

    expect(moveFor(state, "red-0")?.captures).toEqual([]);
  });

  it("opens up only once the pile is down to one token", () => {
    // The whole life of a pile on cell 5, probed at each stage by a red token
    // on cell 3 rolling a 2. Green pairs up, Yellow stacks on top, then Green
    // walks its two tokens off one at a time.
    const probe = (occupants: string[]) => {
      let state = fourPlayerGame();
      for (const id of occupants) state = withToken(state, id, { type: "track", index: 5 });
      state = withToken(state, "red-0", { type: "track", index: 3 });
      return moveFor(withDice(state, 2), "red-0")?.captures;
    };

    expect(probe(["green-0", "green-1", "yellow-0"])).toEqual([]); // three deep
    expect(probe(["green-0", "yellow-0"])).toEqual([]); // decayed, still two deep
    expect(probe(["yellow-0"])).toEqual(["yellow-0"]); // one left — capturable
  });

  it("captures again once a decayed stack is down to a single token", () => {
    let state = fourPlayerGame();
    state = withToken(state, "green-0", { type: "track", index: 5 });
    state = withToken(state, "red-0", { type: "track", index: 3 });
    state = withDice(state, 2);

    expect(moveFor(state, "red-0")?.captures).toEqual(["green-0"]);
  });

  it("lets a third player pile onto an already-shared cell", () => {
    let state = fourPlayerGame();
    state = withToken(state, "green-0", { type: "track", index: 5 });
    state = withToken(state, "green-1", { type: "track", index: 5 });
    state = withToken(state, "yellow-0", { type: "track", index: 5 });
    state = withToken(state, "red-0", { type: "track", index: 3 });
    state = withDice(state, 2);

    const move = moveFor(state, "red-0");
    expect(move?.to).toEqual({ type: "track", index: 5 });
    expect(move?.captures).toEqual([]);
  });

  it("counts the mover's own token toward immunity, shielding a lone opponent", () => {
    // red-0 and yellow-0 already share cell 5. Red bringing a second token in
    // makes the cell two-deep BEFORE the capture check, so yellow-0 survives.
    let state = twoPlayerGame();
    state = withToken(state, "red-0", { type: "track", index: 5 });
    state = withToken(state, "yellow-0", { type: "track", index: 5 });
    state = withToken(state, "red-1", { type: "track", index: 3 });
    state = withDice(state, 2);

    expect(moveFor(state, "red-1")?.captures).toEqual([]);
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
