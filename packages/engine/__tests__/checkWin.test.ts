import { describe, it, expect } from "vitest";
import { checkWin } from "../src/index.js";
import { twoPlayerGame, withToken } from "./helpers.js";

describe("checkWin", () => {
  it("reports no winner at the start", () => {
    expect(checkWin(twoPlayerGame())).toEqual({ finished: false });
  });

  it("reports a winner once a player's four tokens are all finished", () => {
    let state = twoPlayerGame();
    for (const id of ["red-0", "red-1", "red-2", "red-3"]) {
      state = withToken(state, id, "finished");
    }
    expect(checkWin(state)).toEqual({ finished: true, winnerPlayerId: "p1" });
  });

  it("does not declare a winner with only three tokens home", () => {
    let state = twoPlayerGame();
    for (const id of ["red-0", "red-1", "red-2"]) {
      state = withToken(state, id, "finished");
    }
    expect(checkWin(state).finished).toBe(false);
  });

  it("honors an already-recorded winner", () => {
    const state = { ...twoPlayerGame(), winnerPlayerId: "p2" };
    expect(checkWin(state)).toEqual({ finished: true, winnerPlayerId: "p2" });
  });
});
