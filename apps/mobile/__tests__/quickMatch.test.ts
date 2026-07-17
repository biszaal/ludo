/**
 * Quick match: queue, hidden-bot fill timer, and the races around it.
 *
 * The store arms a jittered fill timer while waiting; a human joining first
 * (realtime flips the game active) must disarm it, and leaving must cancel it.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { createGame, type GameState } from "@ludo/engine";
import type { RealtimeChannel } from "@supabase/supabase-js";

vi.mock("../src/net/api", () => ({
  createGame: vi.fn(),
  joinGame: vi.fn(),
  quickMatch: vi.fn(),
  quickBotFill: vi.fn(),
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
  upsertMyProfile: vi.fn().mockResolvedValue(undefined),
  setConnected: vi.fn().mockResolvedValue(undefined),
  subscribeGame: vi.fn(),
  unsubscribe: vi.fn(),
  sendChat: vi.fn(),
}));

import * as api from "../src/net/api";
import { useOnlineStore } from "../src/store/onlineStore";

const store = useOnlineStore;

/** Past the fill window's max (8s base + 6s jitter). */
const PAST_FILL_MS = 15_000;

const P1 = { id: "p1", userId: "u1", color: "red" as const };
const P2 = { id: "p2", userId: "u2", color: "yellow" as const };

function dealtGame(): GameState {
  return createGame([P1, P2], { gameId: "g1" });
}

function row(state: GameState, v: number): api.GameRow {
  return {
    id: "g1",
    room_code: "QQQQ",
    host_user_id: "u1",
    status: "active",
    state,
    current_turn_player_id: state.currentTurnPlayerId,
    state_version: v,
  };
}

let subs: api.GameSubscription;

async function startSearch(): Promise<void> {
  vi.mocked(api.quickMatch).mockResolvedValue({
    gameId: "g1",
    userId: "u1",
    myPlayerId: "p1",
    waiting: true,
  });
  vi.mocked(api.subscribeGame).mockImplementation((_gameId, handlers) => {
    subs = handlers;
    return {} as RealtimeChannel;
  });
  await store.getState().quickMatch();
  expect(store.getState().status).toBe("lobby");
  expect(store.getState().isQuick).toBe(true);
  expect(store.getState().roomCode).toBeNull();
}

afterEach(() => {
  store.getState().leave();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("quick match", () => {
  it("fills with a hidden bot after the wait window", async () => {
    vi.useFakeTimers();
    await startSearch();

    const dealt = dealtGame();
    vi.mocked(api.quickBotFill).mockResolvedValue({ state: dealt, v: 1 });

    await vi.advanceTimersByTimeAsync(PAST_FILL_MS);
    expect(api.quickBotFill).toHaveBeenCalledTimes(1);
    expect(store.getState().state).toEqual(dealt);
    expect(store.getState().status).toBe("active");
  });

  it("never asks for a fill when a human match arrives first", async () => {
    vi.useFakeTimers();
    await startSearch();

    // The claiming searcher started the game — the row lands via realtime.
    subs.onGame(row(dealtGame(), 1));
    await vi.advanceTimersByTimeAsync(PAST_FILL_MS);

    expect(api.quickBotFill).not.toHaveBeenCalled();
    expect(store.getState().status).toBe("active");
  });

  it("cancelling the search disarms the fill timer", async () => {
    vi.useFakeTimers();
    await startSearch();

    store.getState().leave();
    await vi.advanceTimersByTimeAsync(PAST_FILL_MS);

    expect(api.quickBotFill).not.toHaveBeenCalled();
    expect(api.leaveAction).toHaveBeenCalledWith("g1");
  });

  it("an instant pairing skips the lobby entirely", async () => {
    const dealt = dealtGame();
    vi.mocked(api.quickMatch).mockResolvedValue({
      gameId: "g1",
      userId: "u2",
      myPlayerId: "p2",
      state: dealt,
      v: 1,
    });
    vi.mocked(api.subscribeGame).mockImplementation((_gameId, handlers) => {
      subs = handlers;
      return {} as RealtimeChannel;
    });

    await store.getState().quickMatch();
    expect(store.getState().status).toBe("active");
    expect(store.getState().state).toEqual(dealt);
  });
});
