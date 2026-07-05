import { describe, it, expect } from "vitest";
import { createGame } from "../src/index.js";
import { twoPlayerGame, fourPlayerGame } from "./helpers.js";

describe("createGame", () => {
  it("creates a ready-to-play 2-player game", () => {
    const state = twoPlayerGame();
    expect(state.status).toBe("active");
    expect(state.players).toHaveLength(2);
    expect(state.currentTurnPlayerId).toBe("p1");
    expect(state.phase).toBe("awaiting-roll");
    expect(state.diceValue).toBeNull();
    expect(state.consecutiveSixes).toBe(0);
    expect(state.winnerPlayerId).toBeNull();
  });

  it("gives every player four tokens, all in the yard", () => {
    const state = fourPlayerGame();
    expect(state.tokens).toHaveLength(16);
    expect(state.tokens.every((t) => t.position === "home")).toBe(true);
    for (const player of state.players) {
      expect(state.tokens.filter((t) => t.playerId === player.id)).toHaveLength(4);
    }
  });

  it("auto-assigns colors in clockwise order when omitted", () => {
    const state = createGame([
      { id: "a", userId: "ua" },
      { id: "b", userId: "ub" },
      { id: "c", userId: "uc" },
    ]);
    expect(state.players.map((p) => p.color)).toEqual(["red", "green", "yellow"]);
  });

  it("honors explicitly chosen colors and fills the rest", () => {
    const state = createGame([
      { id: "a", userId: "ua", color: "blue" },
      { id: "b", userId: "ub" },
    ]);
    expect(state.players.map((p) => p.color)).toEqual(["blue", "red"]);
  });

  it("rejects games with fewer than 2 or more than 4 players", () => {
    expect(() => createGame([{ id: "a", userId: "ua" }])).toThrow();
    expect(() =>
      createGame([
        { id: "a", userId: "ua" },
        { id: "b", userId: "ub" },
        { id: "c", userId: "uc" },
        { id: "d", userId: "ud" },
        { id: "e", userId: "ue" },
      ]),
    ).toThrow();
  });

  it("rejects duplicate color assignments", () => {
    expect(() =>
      createGame([
        { id: "a", userId: "ua", color: "red" },
        { id: "b", userId: "ub", color: "red" },
      ]),
    ).toThrow();
  });

  it("does not assign the same color twice automatically", () => {
    const state = fourPlayerGame();
    const colors = state.players.map((p) => p.color);
    expect(new Set(colors).size).toBe(colors.length);
  });
});
