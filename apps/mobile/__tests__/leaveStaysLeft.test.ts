/**
 * Leaving a match must stay left.
 *
 * Applying any authoritative state also navigates to the game screen. leave()
 * resets the store and pops to Home, but a request already in flight — a
 * resync fetch, a roll — still resolves afterwards, and nothing checked that
 * the room was still ours: the late answer re-applied the old board and pushed
 * the game screen back. Seen in a 1.2.3 smoke test (2026-10-22): after
 * confirming Leave, the player sat on a seatless game ("Waiting for Red…",
 * names gone, clock running) instead of Home.
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
import { useNav } from "../src/store/navStore";

const store = useOnlineStore;

const P1 = { id: "p1", userId: "u1", color: "red" as const };
const P2 = { id: "p2", userId: "u2", color: "yellow" as const };

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

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function joinActiveGame(state: GameState): Promise<void> {
  vi.mocked(api.joinGame).mockResolvedValue({ gameId: "g1", roomCode: "ABCD", userId: "u1", myPlayerId: "p1" });
  vi.mocked(api.fetchGame).mockResolvedValue(row(state, 1));
  vi.mocked(api.subscribeGame).mockImplementation(() => ({}) as RealtimeChannel);
  await store.getState().join("ABCD");
  expect(useNav.getState().stack.at(-1)!.name).toBe("onlineGame");
}

const top = () => useNav.getState().stack.at(-1)!.name;

afterEach(() => {
  store.getState().leave();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("an answer that lands after leaving", () => {
  it("does not reopen the game from a resync fetch", async () => {
    vi.useFakeTimers();
    await joinActiveGame(myTurn());

    const late = deferred<api.GameRow>();
    vi.mocked(api.fetchGame).mockReturnValue(late.promise);
    await store.getState().resync();
    await vi.advanceTimersByTimeAsync(1_000); // coalesce window: the fetch is now out

    store.getState().leave();
    expect(top()).toBe("home");

    late.resolve(row(myTurn(), 2));
    await vi.advanceTimersByTimeAsync(0);

    expect(store.getState().state).toBeNull();
    expect(top()).toBe("home");
  });

  it("does not reopen the game from a roll's answer", async () => {
    vi.useFakeTimers();
    await joinActiveGame(myTurn());

    const late = deferred<api.TurnResult>();
    vi.mocked(api.rollAction).mockReturnValue(late.promise);
    void store.getState().roll();
    await vi.advanceTimersByTimeAsync(0);

    store.getState().leave();
    const rolled: GameState = { ...myTurn(), phase: "awaiting-move", diceValue: 3 };
    late.resolve({ state: rolled, v: 2 });
    await vi.advanceTimersByTimeAsync(0);

    expect(store.getState().state).toBeNull();
    expect(top()).toBe("home");
  });
});
