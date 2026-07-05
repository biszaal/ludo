import { describe, it, expect } from "vitest";
import { applyMove } from "../src/index.js";
import { twoPlayerGame, withToken, withDice } from "./helpers.js";

describe("applyMove — captures", () => {
  it("sends a captured opponent back to its yard", () => {
    let state = twoPlayerGame();
    state = withToken(state, "yellow-0", { type: "track", index: 5 });
    state = withToken(state, "red-0", { type: "track", index: 3 });
    state = withDice(state, 2);

    const next = applyMove(state, { tokenId: "red-0" });

    expect(next.tokens.find((t) => t.id === "red-0")!.position).toEqual({ type: "track", index: 5 });
    expect(next.tokens.find((t) => t.id === "yellow-0")!.position).toBe("home");
  });

  it("grants the captor a bonus turn (no hand-off)", () => {
    let state = twoPlayerGame();
    state = withToken(state, "yellow-0", { type: "track", index: 5 });
    state = withToken(state, "red-0", { type: "track", index: 3 });
    state = withDice(state, 2);

    const next = applyMove(state, { tokenId: "red-0" });
    expect(next.currentTurnPlayerId).toBe("p1");
    expect(next.phase).toBe("awaiting-roll");
    expect(next.diceValue).toBeNull();
  });

  it("does not capture or grant a bonus on a safe square", () => {
    let state = twoPlayerGame();
    state = withToken(state, "yellow-0", { type: "track", index: 8 }); // safe
    state = withToken(state, "red-0", { type: "track", index: 6 });
    state = withDice(state, 2);

    const next = applyMove(state, { tokenId: "red-0" });
    expect(next.tokens.find((t) => t.id === "yellow-0")!.position).toEqual({ type: "track", index: 8 });
    expect(next.currentTurnPlayerId).toBe("p2"); // handed off, no capture bonus
  });

  it("never mutates the input state", () => {
    let state = twoPlayerGame();
    state = withToken(state, "yellow-0", { type: "track", index: 5 });
    state = withToken(state, "red-0", { type: "track", index: 3 });
    state = withDice(state, 2);
    const snapshot = JSON.stringify(state);

    applyMove(state, { tokenId: "red-0" });
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});
