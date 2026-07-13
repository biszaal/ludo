/**
 * moveDurationMs mirrors Board.tsx's hop animation: landing sounds (capture,
 * safe chime, finish) must not fire before the pawn visibly arrives.
 */

import { describe, it, expect } from "vitest";
import { createGame, fromRelativeIndex, type GameState, type TokenPosition } from "@ludo/engine";
import { FLY_MS, HOP_STEP_MS, moveDurationMs, stateAnimationMs } from "../src/lib/moveTiming";

describe("moveDurationMs", () => {
  it("walks contiguous track moves cell-by-cell", () => {
    const was = fromRelativeIndex("red", 5);
    const now = fromRelativeIndex("red", 8);
    expect(moveDurationMs("red", was, now)).toBe(3 * HOP_STEP_MS);
  });

  it("walks into the home column at the same pace", () => {
    const was = fromRelativeIndex("blue", 49);
    const now = fromRelativeIndex("blue", 53);
    expect(moveDurationMs("blue", was, now)).toBe(4 * HOP_STEP_MS);
  });

  it("hops a single cell in one step", () => {
    const was = fromRelativeIndex("green", 10);
    const now = fromRelativeIndex("green", 11);
    expect(moveDurationMs("green", was, now)).toBe(HOP_STEP_MS);
  });

  it("flies when leaving the yard", () => {
    expect(moveDurationMs("yellow", "home", fromRelativeIndex("yellow", 0))).toBe(FLY_MS);
  });

  it("flies a captured token back home", () => {
    expect(moveDurationMs("red", fromRelativeIndex("red", 20), "home")).toBe(FLY_MS);
  });
});

describe("stateAnimationMs", () => {
  const base = (): GameState =>
    createGame(
      [
        { id: "p1", userId: "u1", color: "red" },
        { id: "p2", userId: "u2", color: "yellow" },
      ],
      { gameId: "g1" },
    );

  const withToken = (state: GameState, tokenId: string, position: TokenPosition): GameState => ({
    ...state,
    tokens: state.tokens.map((t) => (t.id === tokenId ? { ...t, position } : t)),
  });

  it("is zero when nothing moved", () => {
    const s = base();
    expect(stateAnimationMs(s, { ...s })).toBe(0);
  });

  it("is zero across different games (fresh board, nothing to animate)", () => {
    const a = base();
    const b = { ...base(), gameId: "g2" };
    expect(stateAnimationMs(a, b)).toBe(0);
  });

  it("matches the mover's hop time for a plain track move", () => {
    const prev = withToken(base(), "red-0", fromRelativeIndex("red", 5));
    const next = withToken(prev, "red-0", fromRelativeIndex("red", 9));
    expect(stateAnimationMs(prev, next)).toBe(4 * HOP_STEP_MS);
  });

  it("adds the captured token's fly home after the mover lands", () => {
    // Yellow sits where red will land: red hops 3 cells, then yellow flies home.
    const landing = fromRelativeIndex("red", 8);
    let prev = withToken(base(), "red-0", fromRelativeIndex("red", 5));
    prev = withToken(prev, "yellow-0", landing);
    let next = withToken(prev, "red-0", landing);
    next = withToken(next, "yellow-0", "home");
    expect(stateAnimationMs(prev, next)).toBe(3 * HOP_STEP_MS + FLY_MS);
  });

  it("uses the fly time for a resync-style jump (>6 cells)", () => {
    const prev = withToken(base(), "red-0", fromRelativeIndex("red", 5));
    const next = withToken(prev, "red-0", fromRelativeIndex("red", 20));
    expect(stateAnimationMs(prev, next)).toBe(FLY_MS);
  });
});
