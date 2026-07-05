import { describe, it, expect } from "vitest";
import { rollDice, createSeededRng } from "../src/index.js";
import { twoPlayerGame, scriptedRng } from "./helpers.js";

describe("rollDice", () => {
  it("maps a scripted rng to the intended die and enters awaiting-move", () => {
    const { newState, diceValue, busted } = rollDice(twoPlayerGame(), scriptedRng([4]));
    expect(diceValue).toBe(4);
    expect(busted).toBe(false);
    expect(newState.phase).toBe("awaiting-move");
    expect(newState.diceValue).toBe(4);
  });

  it("covers the full 1..6 range via the scripted rng", () => {
    for (let d = 1; d <= 6; d++) {
      expect(rollDice(twoPlayerGame(), scriptedRng([d])).diceValue).toBe(d);
    }
  });

  it("counts consecutive sixes", () => {
    const { newState } = rollDice(twoPlayerGame(), scriptedRng([6]));
    expect(newState.consecutiveSixes).toBe(1);
    expect(newState.diceValue).toBe(6);
  });

  it("forfeits the turn on a third consecutive six", () => {
    const primed = { ...twoPlayerGame(), consecutiveSixes: 2 };
    const { newState, busted } = rollDice(primed, scriptedRng([6]));
    expect(busted).toBe(true);
    expect(newState.currentTurnPlayerId).toBe("p2"); // handed off
    expect(newState.phase).toBe("awaiting-roll");
    expect(newState.diceValue).toBeNull();
    expect(newState.consecutiveSixes).toBe(0);
  });

  it("does not bust the third six when the rule is disabled", () => {
    const primed = {
      ...twoPlayerGame(),
      consecutiveSixes: 2,
      rules: { ...twoPlayerGame().rules, threeSixesForfeit: false },
    };
    const { busted, newState } = rollDice(primed, scriptedRng([6]));
    expect(busted).toBe(false);
    expect(newState.currentTurnPlayerId).toBe("p1");
    expect(newState.consecutiveSixes).toBe(3);
  });

  it("refuses to roll twice without a move in between", () => {
    const { newState } = rollDice(twoPlayerGame(), scriptedRng([4]));
    expect(() => rollDice(newState, scriptedRng([2]))).toThrow();
  });

  it("is deterministic for a given seed", () => {
    const a = rollDice(twoPlayerGame(), createSeededRng(123)).diceValue;
    const b = rollDice(twoPlayerGame(), createSeededRng(123)).diceValue;
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(1);
    expect(a).toBeLessThanOrEqual(6);
  });

  it("does not mutate the input state", () => {
    const state = twoPlayerGame();
    rollDice(state, scriptedRng([6]));
    expect(state.phase).toBe("awaiting-roll");
    expect(state.diceValue).toBeNull();
  });
});
