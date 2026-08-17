/**
 * moveDurationMs mirrors Board.tsx's hop animation: landing sounds (capture,
 * safe chime, finish) must not fire before the pawn visibly arrives.
 */

import { describe, it, expect } from "vitest";
import { createGame, fromRelativeIndex, type GameState, type TokenPosition } from "@ludo/engine";
import { DICE_ROLL_MS, FLY_MS, HOP_STEP_MS, moveDurationMs, stateAnimationMs } from "../src/lib/moveTiming";
import { RETURN_TOTAL_MS } from "../src/render/waypoints";

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

  it("walks a captured token back home the way it came", () => {
    // 20 cells behind it plus the yard slot, paced to the retrace budget —
    // much longer than the old straight fly, which is the point: sounds timed
    // off this must wait for the pawn to actually get home.
    const ms = moveDurationMs("red", fromRelativeIndex("red", 20), "home");
    expect(ms).toBeGreaterThan(FLY_MS);
    expect(ms).toBe(21 * Math.round(RETURN_TOTAL_MS / 21));
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

  it("adds the captured token's walk home after the mover lands", () => {
    // Yellow sits where red will land: red hops 3 cells, THEN yellow retraces.
    // Red's cell 8 is 34 cells along yellow's own route, so yellow has a long
    // way back — and the hold must cover all of it or the next queued state
    // lands mid-retrace and snaps the pawn into its yard.
    const landing = fromRelativeIndex("red", 8);
    let prev = withToken(base(), "red-0", fromRelativeIndex("red", 5));
    prev = withToken(prev, "yellow-0", landing);
    let next = withToken(prev, "red-0", landing);
    next = withToken(next, "yellow-0", "home");

    const retrace = moveDurationMs("yellow", landing, "home");
    expect(stateAnimationMs(prev, next)).toBe(3 * HOP_STEP_MS + retrace);
  });

  it("uses the fly time for a resync-style jump (>6 cells)", () => {
    const prev = withToken(base(), "red-0", fromRelativeIndex("red", 5));
    const next = withToken(prev, "red-0", fromRelativeIndex("red", 20));
    expect(stateAnimationMs(prev, next)).toBe(FLY_MS);
  });

  // A roll moves no token, so this used to be 0 and the row queue held the
  // next state for 80ms — an opponent's pawn moved before their die landed and
  // nobody could read the number.
  it("holds for the die tumble on a roll that moves nothing", () => {
    const prev = base();
    const next = { ...prev, phase: "awaiting-move" as const, diceValue: 4 };
    expect(stateAnimationMs(prev, next)).toBeGreaterThanOrEqual(DICE_ROLL_MS);
  });

  it("adds the tumble ahead of the mover when a roll and a move arrive together", () => {
    const prev = withToken(base(), "red-0", fromRelativeIndex("red", 5));
    const moved = withToken(prev, "red-0", fromRelativeIndex("red", 9));
    const next = { ...moved, phase: "awaiting-move" as const, diceValue: 4 };
    expect(stateAnimationMs(prev, next)).toBeGreaterThan(4 * HOP_STEP_MS + DICE_ROLL_MS);
  });

  it("does not re-hold when the dice value is unchanged", () => {
    const prev = { ...base(), phase: "awaiting-move" as const, diceValue: 4 };
    const next = withToken(prev, "red-0", fromRelativeIndex("red", 4));
    expect(stateAnimationMs(prev, next)).toBe(FLY_MS);
  });
});
