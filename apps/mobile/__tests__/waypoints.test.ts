/**
 * The pawn's travel path. Driven through the REAL engine for captures, because
 * the two capture shapes (mover already on the track vs. mover coming out of
 * the yard) take different branches and only one of them can hop.
 */

import { describe, it, expect } from "vitest";
import { applyMove, createGame, fromRelativeIndex, type GameState, type TokenPosition } from "@ludo/engine";
import { tokenCenterPx } from "../src/render/boardLayout";
import {
  computeWaypoints,
  FLY_MS,
  HOP_STEP_MS,
  originsFromLastAction,
  RETURN_TOTAL_MS,
} from "../src/render/waypoints";

const CELL = 20;
const dest = { x: 0, y: 0 };

function twoPlayer(): GameState {
  return createGame([
    { id: "p1", userId: "u1", color: "red" },
    { id: "p2", userId: "u2", color: "yellow" },
  ]);
}

function withToken(state: GameState, id: string, position: TokenPosition): GameState {
  return { ...state, tokens: state.tokens.map((t) => (t.id === id ? { ...t, position } : t)) };
}

describe("computeWaypoints — ordinary moves", () => {
  it("hops through every cell of a forward move", () => {
    const w = computeWaypoints("red", fromRelativeIndex("red", 5), fromRelativeIndex("red", 8), dest, CELL);
    expect(w).toMatchObject({ walk: true, stepMs: HOP_STEP_MS });
    expect(w.points).toHaveLength(3);
  });

  it("hops a single-cell move rather than sliding", () => {
    const w = computeWaypoints("green", fromRelativeIndex("green", 10), fromRelativeIndex("green", 11), dest, CELL);
    expect(w.walk).toBe(true);
    expect(w.points).toHaveLength(1);
  });

  it("flies out of the yard — there is no path to walk", () => {
    const w = computeWaypoints("yellow", "home", fromRelativeIndex("yellow", 0), dest, CELL);
    expect(w).toMatchObject({ walk: false, stepMs: FLY_MS });
  });
});

describe("computeWaypoints — the capturing mover", () => {
  it("hops to the victim's cell when it was already on the track", () => {
    let state = twoPlayer();
    state = withToken(state, "yellow-0", { type: "track", index: 5 });
    state = withToken(state, "red-0", { type: "track", index: 3 });
    state = { ...state, diceValue: 2, phase: "awaiting-move" };

    const next = applyMove(state, { tokenId: "red-0" });
    const mover = next.tokens.find((t) => t.id === "red-0")!;
    const w = computeWaypoints("red", { type: "track", index: 3 }, mover.position, dest, CELL);

    expect(w.walk).toBe(true);
    expect(w.points).toHaveLength(2);
  });

  it("cannot capture straight out of the yard — so every capture hops", () => {
    // This is the one capture shape that COULDN'T hop (the yard is not on the
    // track), and the rules make it unreachable: every start cell is in
    // SAFE_SQUARES, so a token arriving from the yard never captures. That is
    // what makes "the capturing mover always hops" true rather than incidental.
    let state = twoPlayer();
    state = withToken(state, "yellow-0", { type: "track", index: 0 }); // red's start
    state = { ...state, diceValue: 6, phase: "awaiting-move" };

    const next = applyMove(state, { tokenId: "red-0" });
    expect(next.tokens.find((t) => t.id === "yellow-0")!.position).toEqual({ type: "track", index: 0 });
  });
});

describe("computeWaypoints — the captured token", () => {
  it("retraces its route back to the yard instead of flying straight", () => {
    // yellow-0 is 6 cells along its own route when it gets sent home.
    const from = fromRelativeIndex("yellow", 6);
    const w = computeWaypoints("yellow", from, "home", dest, CELL);

    expect(w).toMatchObject({ walk: true, retrace: true });
    // 6 track cells behind it (rel 5..0) plus the yard slot.
    expect(w.points).toHaveLength(7);
  });

  it("walks backwards, cell by cell, the way it came", () => {
    const w = computeWaypoints("yellow", fromRelativeIndex("yellow", 3), "home", dest, CELL);
    const expected = [2, 1, 0].map((rel) => tokenCenterPx("yellow", fromRelativeIndex("yellow", rel), 0, CELL));
    expect(w.points.slice(0, 3)).toEqual(expected);
    expect(w.points[w.points.length - 1]).toEqual(dest);
  });

  it("keeps even a full-lap retrace watchable", () => {
    // 51 cells at the floor step. Longer than RETURN_TOTAL_MS on purpose: past
    // ~24 cells the budget would push each hop below the point of being seen,
    // so the floor takes over and the longest possible trek lands near 1.3s.
    const w = computeWaypoints("red", fromRelativeIndex("red", 50), "home", dest, CELL);
    expect(w.points).toHaveLength(51);
    expect(w.points.length * w.stepMs).toBeLessThan(1500);
  });

  it("spends the whole budget when the trek is short", () => {
    const w = computeWaypoints("red", fromRelativeIndex("red", 4), "home", dest, CELL);
    expect(w.points.length * w.stepMs).toBeCloseTo(RETURN_TOTAL_MS, -2);
  });

  it("retraces from the home column too", () => {
    const w = computeWaypoints("blue", fromRelativeIndex("blue", 53), "home", dest, CELL);
    expect(w.retrace).toBe(true);
  });
});

describe("originsFromLastAction", () => {
  function play(setup: (s: GameState) => GameState, tokenId: string, dice: number) {
    let state = twoPlayer();
    state = setup(state);
    state = { ...state, diceValue: dice, phase: "awaiting-move" };
    return applyMove(state, { tokenId });
  }

  it("recovers the mover's origin from `to` and the dice", () => {
    const from = fromRelativeIndex("red", 5);
    const next = play((s) => withToken(s, "red-0", from), "red-0", 3);
    expect(originsFromLastAction(next).get("red-0")).toEqual(from);
  });

  it("puts a captured token on the cell the mover landed on", () => {
    // This is the pair the bug destroyed: the mover flew instead of hopping,
    // and the victim teleported instead of retracing.
    const next = play(
      (s) => withToken(withToken(s, "yellow-0", { type: "track", index: 5 }), "red-0", { type: "track", index: 3 }),
      "red-0",
      2,
    );
    const origins = originsFromLastAction(next);
    expect(origins.get("red-0")).toEqual({ type: "track", index: 3 });
    expect(origins.get("yellow-0")).toEqual({ type: "track", index: 5 });

    // And that origin is what makes each animation walk rather than fly.
    const mover = computeWaypoints("red", origins.get("red-0"), { type: "track", index: 5 }, dest, CELL);
    expect(mover.walk).toBe(true);
    const victim = computeWaypoints("yellow", origins.get("yellow-0"), "home", dest, CELL);
    expect(victim).toMatchObject({ walk: true, retrace: true });
  });

  it("reports a yard exit as coming from home, not a negative cell", () => {
    const next = play((s) => s, "red-0", 6); // out of the yard onto the start cell
    expect(originsFromLastAction(next).get("red-0")).toBe("home");
  });

  it("is empty when the last action was not a move", () => {
    const rolled = { ...twoPlayer(), lastAction: { type: "roll" as const, payload: { dice: 4 }, timestamp: 0 } };
    expect(originsFromLastAction(rolled).size).toBe(0);
    expect(originsFromLastAction(twoPlayer()).size).toBe(0);
  });

  it("gives the same answer however many times it is called", () => {
    // The whole point of deriving from state: a re-render cannot change it,
    // which is what a ref updated in an effect could not promise.
    const next = play((s) => withToken(s, "red-0", fromRelativeIndex("red", 5)), "red-0", 4);
    const a = originsFromLastAction(next);
    const b = originsFromLastAction(next);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it("never invents a walk longer than the dice roll", () => {
    for (const dice of [1, 2, 3, 4, 5, 6]) {
      const start = fromRelativeIndex("red", 10);
      const next = play((s) => withToken(s, "red-0", start), "red-0", dice);
      const origin = originsFromLastAction(next).get("red-0");
      const w = computeWaypoints("red", origin, next.tokens.find((t) => t.id === "red-0")!.position, dest, CELL);
      expect(w.points.length).toBe(dice);
    }
  });
});
