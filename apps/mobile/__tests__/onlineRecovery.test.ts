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
  rollAction: vi.fn(),
  moveAction: vi.fn(),
  passAction: vi.fn(),
  timeoutAction: vi.fn(),
  rematchAction: vi.fn(),
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
import { useOnlineStore } from "../src/store/onlineStore";

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
