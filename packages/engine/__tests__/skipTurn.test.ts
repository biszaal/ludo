import { describe, it, expect } from "vitest";
import { skipTurn } from "../src/index.js";
import { twoPlayerGame, withDice } from "./helpers.js";

describe("skipTurn", () => {
  it("hands off from awaiting-roll (player never rolled)", () => {
    const state = twoPlayerGame(); // starts in awaiting-roll on p1
    const next = skipTurn(state);
    expect(next.currentTurnPlayerId).toBe("p2");
    expect(next.phase).toBe("awaiting-roll");
    expect(next.diceValue).toBeNull();
    expect(next.consecutiveSixes).toBe(0);
  });

  it("hands off from awaiting-move even when a legal move exists (rolled, idled)", () => {
    // A 6 from the yard is a legal move; skipTurn ignores that and advances anyway.
    const state = withDice(twoPlayerGame(), 6);
    const next = skipTurn(state);
    expect(next.currentTurnPlayerId).toBe("p2");
    expect(next.phase).toBe("awaiting-roll");
    expect(next.diceValue).toBeNull();
  });

  it("does not mutate the input state", () => {
    const state = twoPlayerGame();
    const before = JSON.stringify(state);
    skipTurn(state);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("throws when the game is not active", () => {
    const finished = { ...twoPlayerGame(), status: "finished" as const };
    expect(() => skipTurn(finished)).toThrow(/not active/);
  });
});
