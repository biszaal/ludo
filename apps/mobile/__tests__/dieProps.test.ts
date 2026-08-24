/**
 * What the die is actually handed across a roll.
 *
 * GameView renders `<Dice value={state.diceValue ?? lastRoll} spinSeq={rollSeq} />`
 * and the Dice component's whole contract is built on that pair: spinSeq bumps
 * once per roll to start the tumble, and `value` going non-null is the signal
 * that there is a number to land on. If either half misbehaves the die spins
 * with nothing to settle onto — which is a bug with no stack trace and no
 * failing assertion anywhere else in the suite, because every existing test
 * checks the STATE rather than the two props the animation reads.
 *
 * So this pins the props themselves, exactly as the component sees them.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { createGame, rollDice, type GameState } from "@ludo/engine";
import type { RealtimeChannel } from "@supabase/supabase-js";

vi.mock("../src/net/api", () => ({
  createGame: vi.fn(),
  joinGame: vi.fn(),
  startGame: vi.fn(),
  newActionId: (() => {
    let n = 0;
    return vi.fn(() => `act-${++n}`);
  })(),
  rollAction: vi.fn(),
  prepareRoll: vi.fn().mockResolvedValue(null),
  moveAction: vi.fn(),
  passAction: vi.fn(),
  timeoutAction: vi.fn(),
  rematchVote: vi.fn(),
  rematchClose: vi.fn(),
  leaveAction: vi.fn().mockResolvedValue(undefined),
  warmUp: vi.fn(),
  getLobby: vi.fn().mockResolvedValue([]),
  lobbyEqual: (a: unknown[], b: unknown[]) =>
    a.length === b.length && a.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i])),
  fetchGame: vi.fn(),
  getProfiles: vi.fn().mockResolvedValue([]),
  upsertMyProfile: vi.fn().mockResolvedValue(null),
  setConnected: vi.fn().mockResolvedValue(undefined),
  subscribeGame: vi.fn(),
  unsubscribe: vi.fn(),
  sendChat: vi.fn(),
  TimeoutError: class TimeoutError extends Error {},
  RowGoneError: class RowGoneError extends Error {},
  isTimeout: (e: unknown) => e instanceof Error && e.name === "TimeoutError",
}));

import * as api from "../src/net/api";
import { useOnlineStore } from "../src/store/onlineStore";

const store = useOnlineStore;
const P1 = { id: "p1", userId: "u1", color: "red" as const };
const P2 = { id: "p2", userId: "u2", color: "yellow" as const };

/** Exactly the expression GameView feeds the die. */
function dieProps(): { value: number | null; spinSeq: number } {
  const s = store.getState();
  return { value: s.state?.diceValue ?? s.lastRoll, spinSeq: s.rollSeq };
}

function row(state: GameState, v: number): api.GameRow {
  return {
    id: "g1",
    room_code: "ABCD",
    host_user_id: "u2",
    status: state.status === "finished" ? "finished" : "active",
    state,
    current_turn_player_id: state.currentTurnPlayerId,
    state_version: v,
  };
}

let subs: api.GameSubscription;

async function joinActiveGame(state: GameState, v = 1): Promise<void> {
  vi.mocked(api.getLobby).mockResolvedValue([]);
  vi.mocked(api.getProfiles).mockResolvedValue([]);
  vi.mocked(api.upsertMyProfile).mockResolvedValue(null);
  vi.mocked(api.setConnected).mockResolvedValue(undefined);
  vi.mocked(api.leaveAction).mockResolvedValue(undefined);
  vi.mocked(api.joinGame).mockResolvedValue({
    gameId: "g1",
    roomCode: "ABCD",
    userId: "u1",
    myPlayerId: "p1",
  });
  vi.mocked(api.fetchGame).mockResolvedValue(row(state, v));
  vi.mocked(api.subscribeGame).mockImplementation((_gameId, handlers) => {
    subs = handlers;
    return {} as RealtimeChannel;
  });
  await store.getState().join("ABCD");
}

afterEach(() => {
  store.getState().leave();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("the die's props across a roll", () => {
  it("clears the number on the tap and restores it from the answer", async () => {
    const before = createGame([P1, P2], { gameId: "g1" });
    await joinActiveGame(before);
    const rolled = rollDice(before, () => 0.99).newState; // a six

    const startSeq = dieProps().spinSeq;
    vi.mocked(api.rollAction).mockResolvedValue({ state: structuredClone(rolled), v: 2 });
    const done = store.getState().roll();

    // The tumble starts on the tap with nothing to land on.
    expect(dieProps()).toEqual({ value: null, spinSeq: startSeq + 1 });

    await done;
    // …and the answer gives it one. A die still holding null here is a die that
    // never stops rolling.
    expect(dieProps()).toEqual({ value: 6, spinSeq: startSeq + 1 });
  });

  it("bumps spinSeq exactly once for one tap", async () => {
    // Twice would restart the tumble mid-flight, so the die would keep
    // re-rolling for as long as writes kept arriving.
    const before = createGame([P1, P2], { gameId: "g1" });
    await joinActiveGame(before);
    const rolled = rollDice(before, () => 0.99).newState;

    const startSeq = dieProps().spinSeq;
    vi.mocked(api.rollAction).mockResolvedValue({ state: structuredClone(rolled), v: 2 });
    await store.getState().roll();
    // The realtime echo of our own write arrives after the HTTP answer.
    subs.onGame(row(structuredClone(rolled), 2));

    expect(dieProps().spinSeq).toBe(startSeq + 1);
  });

  it("gets its number from the realtime echo when the HTTP answer is lost", async () => {
    // The roll landed server-side but the reply never came back. The echo is
    // then the only thing that can end the tumble.
    const before = createGame([P1, P2], { gameId: "g1" });
    await joinActiveGame(before);
    const rolled = rollDice(before, () => 0.99).newState;

    const err = new Error("no answer");
    err.name = "TimeoutError";
    vi.mocked(api.rollAction).mockRejectedValue(err);

    const done = store.getState().roll();
    expect(dieProps().value).toBeNull();
    await done;

    subs.onGame(row(structuredClone(rolled), 2));
    expect(dieProps().value).toBe(6);
  });

  it("keeps tumbling through a duplicate answer, and lands on the echo", async () => {
    // A retry that overtook its own first attempt. The reply is flagged
    // `duplicate` and is deliberately NOT applied: the row it carries may still
    // be the pre-roll one, with the winning write milliseconds behind it, and
    // applying that would snap the board back (see turn.ts duplicateState).
    //
    // The cost lands on the die, which has nothing to settle on until the real
    // state arrives — so it keeps tumbling, which is exactly what it should do.
    // Pinned here because it is the one ordinary path where the roll animation
    // legitimately runs long, and it must not be mistaken for a hang.
    const before = createGame([P1, P2], { gameId: "g1" });
    await joinActiveGame(before);
    const rolled = rollDice(before, () => 0.99).newState;

    vi.mocked(api.rollAction).mockResolvedValue({
      state: structuredClone(rolled),
      v: 2,
      duplicate: true,
    });
    await store.getState().roll();
    expect(dieProps().value).toBeNull();

    // The write's own realtime echo is what ends it.
    subs.onGame(row(structuredClone(rolled), 2));
    expect(dieProps().value).toBe(6);
  });
});
