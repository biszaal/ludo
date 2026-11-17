/**
 * Frenzy vs AI: no turns. Every seat holds its own die, rolls whenever it is
 * empty and recharged, and moves on it; bots drive their seats on their own
 * clocks. Driven through the same actions the screen calls (roll /
 * selectToken / setPaused) with fake timers and a seeded Math.random.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { createSeededRng, type GameState, type TokenPosition } from "@ludo/engine";
import {
  FRENZY_AUTO_MOVE_MS,
  FRENZY_NO_MOVE_HOLD_MS,
  FRENZY_RECHARGE_MS,
  useFrenzyStore,
} from "../src/store/frenzyStore";
import { useNav } from "../src/store/navStore";
import { DICE_ROLL_MS } from "../src/lib/moveTiming";

const store = useFrenzyStore;
/** Long enough for a queued move to reach the board (one animation frame). */
const FRAME = 50;

function seed(n: number) {
  const rng = createSeededRng(n);
  vi.spyOn(Math, "random").mockImplementation(() => rng());
}

/** Make every Math.random call land the die on `face`. */
function nextDie(face: number) {
  vi.spyOn(Math, "random").mockReturnValue((face - 0.5) / 6);
}

function withToken(state: GameState, tokenId: string, position: TokenPosition): GameState {
  return { ...state, tokens: state.tokens.map((t) => (t.id === tokenId ? { ...t, position } : t)) };
}

/** A two-seat game nobody else plays: the human's die in isolation. */
function soloGame(layout: (s: GameState) => GameState = (s) => s) {
  vi.useFakeTimers();
  store.getState().newFrenzyGame({ players: 2, bots: 0 });
  store.setState({ state: layout(store.getState().state!) });
}

const tokenAt = (id: string) => store.getState().state!.tokens.find((t) => t.id === id)!.position;

afterEach(() => {
  store.getState().leaveGame();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("frenzy store", () => {
  it("deals a die per seat, seats the human first and opens the frenzy screen", () => {
    store.getState().newFrenzyGame({ players: 4 });
    const s = store.getState();

    expect(s.state!.frenzy!.dice).toEqual({ p1: null, p2: null, p3: null, p4: null });
    expect(s.me).toBe("p1");
    expect(s.botIds).toEqual(["p2", "p3", "p4"]);
    expect(Object.values(s.seats).every((d) => d.ready && d.held === null)).toBe(true);
    expect(useNav.getState().stack.at(-1)?.name).toBe("frenzyGame");
  });

  it("holds the human's roll and refuses another until it is spent", () => {
    soloGame();
    nextDie(3);
    store.getState().roll();
    expect(store.getState().seats.p1).toMatchObject({ held: 3, face: 3, rollSeq: 1, ready: false });

    store.getState().roll();
    expect(store.getState().seats.p1.rollSeq).toBe(1);
  });

  it("clears a roll with no legal move after a beat, then recharges", () => {
    soloGame(); // every red pawn in the yard
    nextDie(3);
    store.getState().roll();

    vi.advanceTimersByTime(DICE_ROLL_MS + FRENZY_NO_MOVE_HOLD_MS + FRAME);
    expect(store.getState().seats.p1).toMatchObject({ held: null, face: 3, ready: false });

    vi.advanceTimersByTime(FRENZY_RECHARGE_MS);
    expect(store.getState().seats.p1.ready).toBe(true);
  });

  it("plays a lone legal move by itself and recharges once the pawn lands", () => {
    soloGame((s) => withToken(s, "red-0", { type: "track", index: 5 }));
    nextDie(2);
    store.getState().roll();

    vi.advanceTimersByTime(FRENZY_AUTO_MOVE_MS + FRAME);
    expect(tokenAt("red-0")).toEqual({ type: "track", index: 7 });
    const seat = store.getState().seats.p1;
    expect(seat.ready).toBe(false);
    expect(seat.readyAt - Date.now()).toBeGreaterThanOrEqual(FRENZY_RECHARGE_MS);

    store.getState().roll();
    expect(store.getState().seats.p1.rollSeq).toBe(1); // still recharging

    vi.advanceTimersByTime(seat.readyAt - Date.now());
    expect(store.getState().seats.p1.ready).toBe(true);
  });

  it("waits for the human to pick when there is a choice", () => {
    soloGame((s) => withToken(s, "red-0", { type: "track", index: 5 }));
    nextDie(6); // red-0 can advance, or a new pawn can leave the yard
    store.getState().roll();

    vi.advanceTimersByTime(5000);
    expect(store.getState().seats.p1.held).toBe(6);

    store.getState().selectToken("red-0");
    vi.advanceTimersByTime(FRAME);
    expect(tokenAt("red-0")).toEqual({ type: "track", index: 11 });
  });

  it("skips the recharge after a six", () => {
    soloGame((s) => withToken(s, "red-0", { type: "track", index: 5 }));
    nextDie(6);
    store.getState().roll();
    vi.advanceTimersByTime(DICE_ROLL_MS);
    store.getState().selectToken("red-0");
    vi.advanceTimersByTime(FRAME);

    const seat = store.getState().seats.p1;
    expect(seat.readyAt - Date.now()).toBeLessThan(FRENZY_RECHARGE_MS);
  });

  it("ignores a pawn the human has no die for", () => {
    soloGame((s) => withToken(s, "red-0", { type: "track", index: 5 }));
    const before = store.getState().state;
    store.getState().selectToken("red-0");
    vi.advanceTimersByTime(FRAME);
    expect(store.getState().state).toBe(before);
  });

  it("lets the bots race a whole game on their own", () => {
    vi.useFakeTimers();
    seed(7);
    store.getState().newFrenzyGame({ players: 2 }); // the human never acts

    for (let i = 0; i < 4000 && store.getState().state!.status === "active"; i++) vi.advanceTimersByTime(500);

    const game = store.getState().state!;
    expect(game.status).toBe("finished");
    expect(game.finishedOrder).toEqual(["p2", "p1"]);
  });

  it("freezes every bot while paused, and refuses the human's roll", () => {
    vi.useFakeTimers();
    seed(3);
    store.getState().newFrenzyGame({ players: 4 });
    vi.advanceTimersByTime(4000);

    store.getState().setPaused(true);
    const frozen = store.getState().state;
    store.getState().roll();
    vi.advanceTimersByTime(60_000);
    expect(store.getState().state).toBe(frozen);

    store.getState().setPaused(false);
    vi.advanceTimersByTime(4000);
    expect(store.getState().state).not.toBe(frozen);
  });

  it("pushes a recharge back by the time spent paused", () => {
    soloGame();
    nextDie(3);
    store.getState().roll();
    vi.advanceTimersByTime(DICE_ROLL_MS + FRENZY_NO_MOVE_HOLD_MS + FRAME);
    const readyAt = store.getState().seats.p1.readyAt;

    store.getState().setPaused(true);
    vi.advanceTimersByTime(10_000);
    store.getState().setPaused(false);

    expect(store.getState().seats.p1.readyAt).toBe(readyAt + 10_000);
    expect(store.getState().seats.p1.ready).toBe(false);
    vi.advanceTimersByTime(store.getState().seats.p1.readyAt - Date.now());
    expect(store.getState().seats.p1.ready).toBe(true);
  });

  it("keeps the setup for a rematch", () => {
    store.getState().newFrenzyGame({ players: 3 });
    expect(store.getState().lastConfig).toEqual({ players: 3 });
  });

  it("stops the bots and goes home on leave", () => {
    vi.useFakeTimers();
    seed(5);
    store.getState().newFrenzyGame({ players: 4 });
    store.getState().leaveGame();
    vi.advanceTimersByTime(10_000);

    expect(store.getState().state).toBeNull();
    expect(useNav.getState().stack.map((e) => e.name)).toEqual(["home"]);
  });
});
