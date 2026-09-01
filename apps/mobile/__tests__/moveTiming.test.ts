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
  dieHandoverMs,
  dieHoldFor,
  latchRoll,
  moveDurationMs,
  ROLL_PACING_MS,
  stateAnimationMs,
  type RollLatch,
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

/**
 * The die must not leave the player who rolled it until their pawn has landed.
 *
 * A move that ends the turn arrives as ONE state: the token has moved, the
 * die is cleared, and `currentTurnPlayerId` already names the next player. The
 * board animates the hop over that transition, but the die is rendered beside
 * whichever seat is current — so it teleported to the next player on the frame
 * the state applied, taking the number with it while the pawn was still in the
 * air. On a four-player table an opponent's roll was gone before it could be
 * read: the whole account of what just happened, removed mid-sentence.
 *
 * dieHandoverMs is how long the die stays put: the mover's own animation, the
 * same clock the Board hops to, so the number is still there when the pawn
 * lands and gone by the time the next player is asked to roll.
 */
describe("dieHandoverMs", () => {
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

  const handTo = (state: GameState, playerId: string): GameState => ({
    ...state,
    currentTurnPlayerId: playerId,
    diceValue: null,
  });

  it("holds the die for the mover's hop when the turn changes hands", () => {
    const prev = { ...withToken(base(), "red-0", fromRelativeIndex("red", 5)), diceValue: 4 };
    const next = handTo(withToken(prev, "red-0", fromRelativeIndex("red", 9)), "p2");
    expect(dieHandoverMs(prev, next)).toBe(4 * HOP_STEP_MS);
  });

  it("covers a capture too — the number outlasts the pawn it sent home", () => {
    const landing = fromRelativeIndex("red", 8);
    let prev = withToken(base(), "red-0", fromRelativeIndex("red", 5));
    prev = { ...withToken(prev, "yellow-0", landing), diceValue: 3 };
    let next = withToken(prev, "red-0", landing);
    next = handTo(withToken(next, "yellow-0", "home"), "p2");

    const retrace = moveDurationMs("yellow", landing, "home");
    expect(dieHandoverMs(prev, next)).toBe(3 * HOP_STEP_MS + retrace);
  });

  it("does not hold when the roller keeps the turn — the die never left", () => {
    // A six: same seat rolls again, so there is no handover to delay.
    const prev = { ...withToken(base(), "red-0", fromRelativeIndex("red", 5)), diceValue: 6 };
    const next = withToken(prev, "red-0", fromRelativeIndex("red", 11));
    expect(dieHandoverMs(prev, next)).toBe(0);
  });

  it("does not hold a turn that changed without a roll being seen", () => {
    // A seat that timed out or left: nothing was rolled, so there is no number
    // to keep on screen and the die should follow the turn immediately.
    const prev = base();
    const next = handTo(prev, "p2");
    expect(dieHandoverMs(prev, next)).toBe(0);
  });

  it("does not hold across a different game", () => {
    const prev = { ...base(), diceValue: 5 };
    const next = handTo({ ...base(), gameId: "g2" }, "p2");
    expect(dieHandoverMs(prev, next)).toBe(0);
  });

  it("holds a pass with no mover long enough to read the number", () => {
    // Rolled, nothing legal to do, turn handed on. No pawn animates, so the
    // mover clock is zero — but the number still has to be readable.
    const prev = { ...base(), diceValue: 2 };
    const next = handTo(prev, "p2");
    expect(dieHandoverMs(prev, next)).toBeGreaterThan(0);
  });
});

/**
 * A hand-off must hold the die even when the roll never entered a state.
 *
 * dieHandoverMs originally keyed the hold on `prev.diceValue` — the number the
 * roller had on screen. On a FOLDING table there is never such a number: the
 * roll is broadcast and the state that follows carries the roll AND the move
 * together, so applyMove has already cleared diceValue and `prev` is the state
 * from BEFORE the roll, whose diceValue is null.
 *
 * So the hold never fired for exactly the case it was written for — an
 * opponent's roll — and the die jumped to the next seat the instant their state
 * applied. The number lives in the store's `lastRoll` on that path, so the
 * caller has to be able to say "there was a roll" for itself.
 */
describe("dieHandoverMs on a folding table", () => {
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

  it("holds when the roll was broadcast rather than written", () => {
    // prev.diceValue is null — the roll never entered a state at all.
    const prev = withToken(base(), "red-0", fromRelativeIndex("red", 5));
    const next = {
      ...withToken(prev, "red-0", fromRelativeIndex("red", 9)),
      currentTurnPlayerId: "p2",
      diceValue: null,
    };
    expect(prev.diceValue).toBeNull();
    expect(dieHandoverMs(prev, next, 4)).toBe(4 * HOP_STEP_MS);
  });

  it("still holds on the written path, where the state carried the die", () => {
    const prev = { ...withToken(base(), "red-0", fromRelativeIndex("red", 5)), diceValue: 4 };
    const next = {
      ...withToken(prev, "red-0", fromRelativeIndex("red", 9)),
      currentTurnPlayerId: "p2",
      diceValue: null,
    };
    expect(dieHandoverMs(prev, next, null)).toBe(4 * HOP_STEP_MS);
  });

  it("does not hold a hand-off where nothing was rolled at all", () => {
    // A timeout or a seat leaving: no state die, and no broadcast die either.
    const prev = base();
    const next = { ...prev, currentTurnPlayerId: "p2", diceValue: null };
    expect(dieHandoverMs(prev, next, null)).toBe(0);
  });
});

/**
 * The latch that carries an opponent's number from its broadcast to the
 * hand-off that has to show it.
 *
 * Every case here is a real sequence the online store produces. The one that
 * matters most is "the store forgetting": on a folding table `lastRoll` goes
 * back to null in the SAME setState that changes the state, because applyMove
 * cleared diceValue and that is what the projection honestly reports. Anything
 * that mirrors `lastRoll` therefore reads null at the exact moment the hand-off
 * needs the number, which is how an opponent's die ended up showing the
 * awaiting-roll swirl instead of what they rolled.
 */
describe("latchRoll", () => {
  const seed = (seq: number, value: number | null): RollLatch => ({ seq, value });

  it("takes the number a new roll publishes with it", () => {
    // Our own prepared roll: rollSeq and the number arrive in one setState.
    expect(latchRoll(seed(1, null), 2, 5)).toEqual({ seq: 2, value: 5 });
  });

  it("takes a number that arrives after its roll started", () => {
    // The slow path: the tumble begins with nothing, and the server answers.
    expect(latchRoll(seed(2, null), 2, 3)).toEqual({ seq: 2, value: 3 });
  });

  it("ignores the store forgetting the number", () => {
    // THE BUG. The folded state clears lastRoll in the same render that changes
    // the state, and the hand-off reads the latch during that render.
    const held = seed(2, 4);
    expect(latchRoll(held, 2, null)).toBe(held);
  });

  it("drops the previous roll's number when a new roll begins", () => {
    // A roll whose number has not arrived yet must not inherit the last one, or
    // the die lands on a number the server never sent.
    expect(latchRoll(seed(2, 4), 3, null)).toEqual({ seq: 3, value: null });
  });

  it("keeps its identity when nothing changed", () => {
    // Held in a ref and folded on every render, so a needless new object would
    // be churn on the hottest render path in the game.
    const held = seed(2, 4);
    expect(latchRoll(held, 2, 4)).toBe(held);
  });

  it("carries a number across a spend and a fresh roll", () => {
    // The whole sequence for one opponent turn on a folding table:
    // broadcast -> folded state (lastRoll nulled) -> spent -> next broadcast.
    let latch = seed(7, null);
    latch = latchRoll(latch, 8, 6); // the broadcast
    expect(latch.value).toBe(6);
    latch = latchRoll(latch, 8, null); // the folded state's null
    expect(latch.value).toBe(6);
    latch = { ...latch, value: null }; // spent by the hand-off
    latch = latchRoll(latch, 9, 2); // their next roll
    expect(latch).toEqual({ seq: 9, value: 2 });
  });
});

describe("ROLL_PACING_MS", () => {
  it("is what a written roll is charged, so a broadcast one can be charged the same", () => {
    // The online store arms its hold timer with this on a broadcast. If the two
    // ever drifted, a folded roll would be paced differently from a written one
    // — which is the difference between watching a tumble and watching a pawn
    // set off over the top of it.
    const before = createGame(
      [
        { id: "p1", userId: "u1", color: "red" },
        { id: "p2", userId: "u2", color: "yellow" },
      ],
      { gameId: "g1" },
    );
    const rolledOnly = { ...before, diceValue: 4, phase: "awaiting-move" as const };
    expect(stateAnimationMs(before, rolledOnly)).toBe(ROLL_PACING_MS);
    expect(ROLL_PACING_MS).toBeGreaterThan(DICE_ROLL_MS);
  });
});

/**
 * The hand-off decision and the latch, composed the way the hook composes them.
 *
 * useDieHandover is refs and a timer around exactly these two calls: fold the
 * render's `(rollSeq, lastRoll)` into the latch, then on the next state read the
 * latch, spend it, and ask for a hold. Driving that sequence here is the only
 * way to pin what a watcher actually SEES, since the component itself cannot be
 * rendered in this suite.
 */
describe("the die hand-off, driven as the hook drives it", () => {
  const P1 = { id: "p1", userId: "u1", color: "red" as const };
  const P2 = { id: "p2", userId: "u2", color: "yellow" as const };
  const P3 = { id: "p3", userId: "u3", color: "green" as const };

  /** A minimal stand-in for the hook: latch on render, spend on state change. */
  function watcher(first: GameState) {
    let latch: RollLatch = { seq: 0, value: null };
    let prev = first;
    return {
      /** A render with no new state — a broadcast, or our own prepared roll. */
      render(rollSeq: number, lastRoll: number | null) {
        latch = latchRoll(latch, rollSeq, lastRoll);
      },
      /** A state landing, with whatever `lastRoll` the store publishes alongside. */
      apply(next: GameState, rollSeq: number, lastRoll: number | null) {
        latch = latchRoll(latch, rollSeq, lastRoll);
        const rolled = latch.value;
        latch = { ...latch, value: null };
        const hold = dieHoldFor(prev, next, rolled);
        prev = next;
        return hold;
      },
    };
  }

  const base = (players: Parameters<typeof createGame>[0]): GameState => createGame(players, { gameId: "g1" });

  const moved = (state: GameState, tokenId: string, index: number): GameState => ({
    ...state,
    tokens: state.tokens.map((t) => (t.id === tokenId ? { ...t, position: fromRelativeIndex("red", index) } : t)),
  });

  it("holds an opponent's broadcast die through their hop", () => {
    // The reported bug. The folded state carries the move and NO die, and the
    // store publishes lastRoll: null alongside it — so everything the hold needs
    // has to come from the latch.
    const start = moved(base([P1, P2]), "red-0", 5);
    const w = watcher(start);

    w.render(1, 4); // the broadcast
    const folded = { ...moved(start, "red-0", 9), currentTurnPlayerId: "p2", diceValue: null };
    const hold = w.apply(folded, 1, null); // the folded state, lastRoll nulled

    expect(hold).toEqual({ playerId: "p1", value: 4, ms: 4 * HOP_STEP_MS });
  });

  it("does not hand a seat that never rolled the previous roller's die", () => {
    // p1 rolls and hands over; then p2 leaves without rolling. Nothing may be
    // held at p2's corner — this is what spending the latch buys.
    const start = moved(base([P1, P2, P3]), "red-0", 5);
    const w = watcher(start);

    w.render(1, 4);
    const folded = { ...moved(start, "red-0", 9), currentTurnPlayerId: "p2", diceValue: null };
    expect(w.apply(folded, 1, null)).not.toBeNull();

    // p2 leaves: the turn moves again, with no roll behind it at all.
    const left = { ...folded, currentTurnPlayerId: "p3" };
    expect(w.apply(left, 1, null)).toBeNull();
  });

  it("carries a fresh number through each roll of a six chain", () => {
    // A six keeps the turn, so the folded state leaves the same seat awaiting
    // another roll. Each broadcast must supply its OWN number.
    const start = moved(base([P1, P2]), "red-0", 5);
    const w = watcher(start);

    w.render(1, 6);
    const afterSix = { ...moved(start, "red-0", 11), currentTurnPlayerId: "p1", diceValue: null };
    expect(w.apply(afterSix, 1, null)).toBeNull(); // turn kept — the die is already home

    w.render(2, 3);
    const handed = { ...moved(afterSix, "red-0", 14), currentTurnPlayerId: "p2", diceValue: null };
    expect(w.apply(handed, 2, null)).toEqual({ playerId: "p1", value: 3, ms: 3 * HOP_STEP_MS });
  });

  it("still works on the written path, where the state carries the die", () => {
    // An unfolded table: no broadcast at all, and `lastRoll` tracks diceValue.
    const start = moved(base([P1, P2]), "red-0", 5);
    const w = watcher(start);

    const rolled = { ...start, diceValue: 4, phase: "awaiting-move" as const };
    expect(w.apply(rolled, 1, 4)).toBeNull(); // a roll keeps the turn

    const handed = { ...moved(rolled, "red-0", 9), currentTurnPlayerId: "p2", diceValue: null };
    expect(w.apply(handed, 1, null)).toEqual({ playerId: "p1", value: 4, ms: 4 * HOP_STEP_MS });
  });
});
