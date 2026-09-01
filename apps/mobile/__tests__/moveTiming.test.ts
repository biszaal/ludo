/**
 * moveDurationMs mirrors Board.tsx's hop animation: landing sounds (capture,
 * safe chime, finish) must not fire before the pawn visibly arrives.
 */

import { describe, it, expect } from "vitest";
import { createGame, fromRelativeIndex, type GameState, type TokenPosition } from "@ludo/engine";
import {
  DICE_LANDING_MS,
  DICE_LANDING_REVS,
  DICE_MAX_ROLL_MS,
  DICE_ROLL_MS,
  DICE_SPIN_REV_PER_MS,
  DICE_TURNS_X,
  DICE_TURNS_Y,
  diceLandingMs,
  diceLandingTarget,
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
/**
 * The roll as one continuous phase — the rule that replaced the laps.
 *
 * REPORTED: "the die rolls twice while the internet is slow", and reliably on
 * the first roll of every game, where the prefetch has not landed and the slow
 * path is guaranteed. Fixed 700ms laps that went round again never stopped on a
 * placeholder, but each one eased out to a near-halt before speeding up, which
 * is what a player reads as a second roll.
 *
 * Three properties carry the replacement, and all three are pinned here.
 */
describe("the continuous roll", () => {
  it("puts the rolled face at the camera on every whole revolution", () => {
    // The load-bearing decision: integer turns per revolution mean every whole
    // phi IS the identity rotation, so the roll may stop at any of them and be
    // legible. Non-integers here would land the die on a corner.
    expect(Number.isInteger(DICE_TURNS_X)).toBe(true);
    expect(Number.isInteger(DICE_TURNS_Y)).toBe(true);
  });

  it("always leaves a full revolution of visible slowing down", () => {
    // However unlucky the moment the answer arrives, the landing is never a
    // snap: at least one whole revolution, at most two.
    for (const phi of [0, 0.01, 0.5, 0.99, 1, 3.4, 17.999]) {
      const delta = diceLandingTarget(phi) - phi;
      expect(delta).toBeGreaterThanOrEqual(DICE_LANDING_REVS);
      expect(delta).toBeLessThanOrEqual(DICE_LANDING_REVS + 1);
    }
  });

  it("comes to rest on a whole revolution", () => {
    for (const phi of [0, 0.37, 2.5, 9.81]) {
      expect(Number.isInteger(diceLandingTarget(phi))).toBe(true);
    }
  });

  it("begins the landing at exactly the speed it was already spinning", () => {
    // THE WHOLE FIX. A cubic ease-out over distance d in duration D opens at
    // 3d/D; if that is not the spin rate the die visibly changes speed when the
    // answer lands, and a speed change mid-roll is what reads as a second roll.
    // This is the seam that 09b0606 could not close with two rotation sources.
    for (const phi of [0, 0.25, 0.5, 0.999, 4.2]) {
      const d = diceLandingTarget(phi) - phi;
      const openingRate = (3 * d) / diceLandingMs(phi);
      expect(openingRate).toBeCloseTo(DICE_SPIN_REV_PER_MS, 12);
    }
  });

  it("rolls for longer the longer the server takes", () => {
    // "If the server is slow the die keeps rolling; if it is fast the number
    // lands faster." Measured on the WHOLE roll — the wait plus the landing —
    // because those are not independent: a target has to be a whole revolution,
    // so an answer arriving later in a revolution gets a correspondingly shorter
    // landing. Each further revolution of waiting is a strictly longer roll.
    const whole = (phi: number) => phi / DICE_SPIN_REV_PER_MS + diceLandingMs(phi);
    for (const phi of [0.5, 1.5, 2.5, 3.5]) {
      expect(whole(phi + 1)).toBeGreaterThan(whole(phi));
    }
  });

  it("never stops before the answer has arrived", () => {
    // The property the whole report rests on: whatever the server does, the die
    // is still rolling when the number turns up.
    const whole = (phi: number) => phi / DICE_SPIN_REV_PER_MS + diceLandingMs(phi);
    for (const phi of [0, 0.3, 1, 2.7, 10]) {
      expect(whole(phi)).toBeGreaterThan(phi / DICE_SPIN_REV_PER_MS);
    }
  });

  it("animates an answer already in hand exactly as it always did", () => {
    // Every offline roll, and every prefetched online one: phi is 0 at the tap,
    // so the landing is one revolution over the tumble length the die has
    // always played. This is the case 09b0606 protected and it must not move.
    expect(diceLandingMs(0)).toBeCloseTo(DICE_LANDING_MS, 6);
    expect(diceLandingTarget(0)).toBe(DICE_LANDING_REVS);
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
    const hold = w.apply(handed, 2, null);
    expect(hold).toMatchObject({ playerId: "p1", value: 3 });
    // Three cells is 450ms of hopping, which is now SHORTER than the half
    // second a landed number is owed — so the floor wins and the die waits for
    // the reader rather than for the pawn.
    expect(hold!.ms).toBe(500);
    expect(hold!.ms).toBeGreaterThan(3 * HOP_STEP_MS);
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
