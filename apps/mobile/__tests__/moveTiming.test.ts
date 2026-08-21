/**
 * moveDurationMs mirrors Board.tsx's hop animation: landing sounds (capture,
 * safe chime, finish) must not fire before the pawn visibly arrives.
 */

import { describe, it, expect } from "vitest";
import { createGame, fromRelativeIndex, type GameState, type TokenPosition } from "@ludo/engine";
import {
  DICE_FACE_LOCK_MS,
  DICE_MAX_ROLL_MS,
  DICE_ROLL_MS,
  DICE_TUMBLE_MS,
  diceLandsThisLap,
  FLY_MS,
  HOP_STEP_MS,
  moveDurationMs,
  stateAnimationMs,
} from "../src/lib/moveTiming";
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

/**
 * The die tumbles in fixed laps and finishes on one of them. This decides
 * which — the only choice the roll animation makes, and one that is visibly
 * wrong in both directions.
 *
 * The bug being guarded against is specific and was shipped once: a roll whose
 * number arrived late was allowed to finish the lap it was already on, so the
 * player watched the die decelerate onto one face and then swap to another.
 */
describe("diceLandsThisLap", () => {
  const LAP = 1_000_000; // an arbitrary lap start; only offsets matter
  const ask = (over: Partial<Parameters<typeof diceLandsThisLap>[0]>) => {
    const seenAt = "seenAt" in over ? (over.seenAt as number | null) : null;
    return diceLandsThisLap({
      seenAt,
      haveValue: seenAt !== null,
      lapStartedAt: LAP,
      rollStartedAt: LAP,
      now: LAP + DICE_TUMBLE_MS,
      ...over,
    });
  };

  it("goes round again while the number is still unknown", () => {
    expect(ask({})).toBe(false);
  });

  it("lands when the number was there from the start of the lap", () => {
    // Every offline roll, and any online one answered before the tap rendered.
    expect(ask({ seenAt: LAP })).toBe(true);
  });

  it("lands when the number arrived with the face still a blur", () => {
    const justInTime = LAP + DICE_TUMBLE_MS - DICE_FACE_LOCK_MS;
    expect(ask({ seenAt: justInTime })).toBe(true);
  });

  it("goes round again when the number arrives during the readable tail", () => {
    // One millisecond the wrong side of the lock is the whole bug: the die is
    // nearly stopped, its face is legible, and relabelling it now is the "it
    // showed a 2 and changed to a 5" report.
    const tooLate = LAP + DICE_TUMBLE_MS - DICE_FACE_LOCK_MS + 1;
    expect(ask({ seenAt: tooLate })).toBe(false);
  });

  it("lands on the next lap once the number has had time to settle", () => {
    // The value arrived too late for lap 1; by the end of lap 2 it has been on
    // the face throughout, so the roll ends rather than looping forever.
    const arrived = LAP + DICE_TUMBLE_MS - 10;
    const lapTwo = LAP + DICE_TUMBLE_MS;
    expect(
      diceLandsThisLap({
        seenAt: arrived,
        haveValue: true,
        lapStartedAt: lapTwo,
        rollStartedAt: LAP,
        now: lapTwo + DICE_TUMBLE_MS,
      }),
    ).toBe(true);
  });

  it("gives up rather than spinning forever when no answer ever comes", () => {
    // A dead connection. The die stops with no number on it, which is honest;
    // spinning indefinitely would be the app pretending it is still working.
    expect(
      diceLandsThisLap({
        seenAt: null,
        haveValue: false,
        lapStartedAt: LAP + DICE_MAX_ROLL_MS,
        rollStartedAt: LAP,
        now: LAP + DICE_MAX_ROLL_MS + DICE_TUMBLE_MS,
      }),
    ).toBe(true);
  });

  it("never keeps spinning over a number it is already holding", () => {
    // The safety net. seenAt is a ref the component latches in an effect, and
    // if that ever misses — a render ordering the component did not anticipate,
    // a value that blinked — the die must still stop. Spinning forever on top
    // of an answer already on screen is the worst failure this has: it reads as
    // a frozen game rather than a slow one.
    const stuck = diceLandsThisLap({
      seenAt: null,
      haveValue: true,
      lapStartedAt: LAP,
      rollStartedAt: LAP,
      now: LAP + DICE_TUMBLE_MS,
    });
    // Not this lap — the number has not provably been on the face — but the
    // next one, once the latch has had a lap's grace to catch up.
    expect(stuck).toBe(false);
    expect(
      diceLandsThisLap({
        seenAt: LAP + 10,
        haveValue: true,
        lapStartedAt: LAP + DICE_TUMBLE_MS,
        rollStartedAt: LAP,
        now: LAP + 2 * DICE_TUMBLE_MS,
      }),
    ).toBe(true);
  });

  it("gives up in seconds, not in a turn's worth of spinning", () => {
    // Long enough that an ordinary slow answer (api.TURN_TIMEOUT_MS is 6s for
    // one attempt) still lands on a lap rather than on the cap, short enough
    // that a roll which is never coming back stops looking like a live one.
    expect(DICE_MAX_ROLL_MS).toBeGreaterThan(6_000);
    expect(DICE_MAX_ROLL_MS).toBeLessThan(15_000);
  });

  it("keeps a lap short enough that a loop is a beat, not a wait", () => {
    // Each extra lap is time added to somebody's turn, so the granularity of
    // "go round again" has to stay small.
    expect(DICE_TUMBLE_MS).toBeLessThanOrEqual(DICE_ROLL_MS);
    expect(DICE_FACE_LOCK_MS).toBeLessThan(DICE_TUMBLE_MS);
  });
});
