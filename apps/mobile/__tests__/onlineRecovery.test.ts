/**
 * Online store: the client must never end up with nothing scheduled.
 *
 * Every recovery path (autopilot step, stall-timeout call, resync) is armed
 * from an authoritative write landing. On the local player's own turn nobody
 * else is writing, so a request that fails there can leave the client with no
 * armed timer and no way back — the seat is theirs, the game waits on them, and
 * the UI is frozen. These tests pin the watchdog that breaks that deadlock.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { createGame, type GameState } from "@ludo/engine";
import type { RealtimeChannel } from "@supabase/supabase-js";

vi.mock("../src/net/api", () => ({
  createGame: vi.fn(),
  joinGame: vi.fn(),
  startGame: vi.fn(),
  // Self-contained counter: a vi.mock factory is hoisted, so it cannot close
  // over a module-level binding without tripping its TDZ.
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
  getLobby: vi.fn().mockResolvedValue([]),
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
import { TURN_SECONDS, useOnlineStore } from "../src/store/onlineStore";

const store = useOnlineStore;

const P1 = { id: "p1", userId: "u1", color: "red" as const };
const P2 = { id: "p2", userId: "u2", color: "yellow" as const };

/** p1's turn, awaiting-roll — the seat the whole table is waiting on. */
function myTurn(): GameState {
  return createGame([P1, P2], { gameId: "g1" });
}

function row(state: GameState, v: number): api.GameRow {
  return {
    id: "g1",
    room_code: "ABCD",
    host_user_id: "u2",
    status: "active",
    state,
    current_turn_player_id: state.currentTurnPlayerId,
    state_version: v,
  };
}

function timeoutError(): Error {
  const e = new Error("Still waiting on the server.");
  e.name = "TimeoutError";
  return e;
}

async function joinActiveGame(state: GameState, v = 1): Promise<void> {
  vi.mocked(api.joinGame).mockResolvedValue({
    gameId: "g1",
    roomCode: "ABCD",
    userId: "u1",
    myPlayerId: "p1",
  });
  vi.mocked(api.fetchGame).mockResolvedValue(row(state, v));
  vi.mocked(api.subscribeGame).mockImplementation(() => ({}) as RealtimeChannel);
  await store.getState().join("ABCD");
  expect(store.getState().state).toEqual(state);
}

afterEach(() => {
  store.getState().leave();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("stall recovery on the local player's own turn", () => {
  it("keeps trying after the roll AND the stall-timeout call both fail", async () => {
    vi.useFakeTimers();
    await joinActiveGame(myTurn());

    // The network is down: the roll, the resync and the stall-timeout backstop
    // all fail, so nothing can re-arm the clocks the way a landing state would.
    vi.mocked(api.rollAction).mockRejectedValue(timeoutError());
    vi.mocked(api.timeoutAction).mockRejectedValue(new Error("Network request failed"));
    vi.mocked(api.fetchGame).mockRejectedValue(new Error("Network request failed"));

    await store.getState().roll();

    // The one-shot stall timer fires (~TURN_SECONDS + grace) and also fails.
    await vi.advanceTimersByTimeAsync(40_000);
    expect(api.timeoutAction).toHaveBeenCalled();

    // Nothing else is writing to this game — it is our seat. If the client
    // armed nothing here, the table is deadlocked forever.
    vi.mocked(api.timeoutAction).mockClear();
    vi.mocked(api.fetchGame).mockClear();
    await vi.advanceTimersByTimeAsync(120_000);

    const retries =
      vi.mocked(api.timeoutAction).mock.calls.length +
      vi.mocked(api.fetchGame).mock.calls.length;
    expect(retries).toBeGreaterThan(0);
  });

  it("reconciles a roll whose request timed out", async () => {
    vi.useFakeTimers();
    await joinActiveGame(myTurn());
    vi.mocked(api.rollAction).mockRejectedValue(timeoutError());
    vi.mocked(api.fetchGame).mockClear();

    await store.getState().roll();
    // A move/pass timeout resyncs; a roll timeout must too — nothing else will
    // tell us whether the write landed.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(api.fetchGame).toHaveBeenCalled();
  });
});

/**
 * A retry can overlap the very attempt it is replacing, so the server answers
 * the loser with `duplicate` and a row that may predate the winner's write by
 * milliseconds. Applied like an ordinary result it would undo the action — the
 * exact snap-back the retry exists to prevent, now caused by the fix.
 */
describe("an action the server has already applied", () => {
  it("leaves the moved pawn where the player put it", async () => {
    vi.useFakeTimers();
    const rolled = { ...myTurn(), phase: "awaiting-move" as const, diceValue: 6 };
    await joinActiveGame(rolled, 5);

    const moves = store.getState().validMoves;
    expect(moves.length).toBeGreaterThan(0);
    const tokenId = moves[0]!.tokenId;

    // The stale row the overlapping attempt read: the state from BEFORE the move.
    vi.mocked(api.moveAction).mockResolvedValue({ state: rolled, v: 5, duplicate: true });
    await store.getState().selectToken(tokenId);

    // The prediction is still on screen — the token did not walk back.
    expect(store.getState().state).not.toEqual(rolled);
    // And something is scheduled to reconcile it. Without this the client sits
    // on an unconfirmed prediction with nothing armed to ever settle it: the
    // version guard silently drops the stale row, and on our own seat nobody
    // else writes the game.
    vi.mocked(api.fetchGame).mockClear();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(api.fetchGame).toHaveBeenCalled();
  });

  it("keeps the die airborne instead of settling it on a stale row", async () => {
    vi.useFakeTimers();
    const start = myTurn();
    await joinActiveGame(start, 5);

    vi.mocked(api.rollAction).mockResolvedValue({ state: start, v: 5, duplicate: true });
    await store.getState().roll();

    // No number to show yet — the real one arrives with the winning write.
    expect(store.getState().lastRoll).toBeNull();
    // And it must not be left waiting forever on it.
    vi.mocked(api.fetchGame).mockClear();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(api.fetchGame).toHaveBeenCalled();
  });
});

describe("autopilot while an action of our own is in flight", () => {
  it("does not take the seat from a player whose roll is still travelling", async () => {
    vi.useFakeTimers();
    await joinActiveGame(myTurn());

    // A slow link: the call is retrying and has not answered yet.
    let settle: (v: api.TurnResult) => void = () => {};
    vi.mocked(api.rollAction).mockReturnValue(new Promise((resolve) => { settle = resolve; }));
    void store.getState().roll();

    // The idle clock runs out. The player is not idle — they rolled.
    await vi.advanceTimersByTimeAsync(TURN_SECONDS * 1000 + 1000);
    expect(store.getState().autoPilot).toBe(false);

    settle({ state: myTurn(), v: 2 });
    await vi.advanceTimersByTimeAsync(0);
  });
});
