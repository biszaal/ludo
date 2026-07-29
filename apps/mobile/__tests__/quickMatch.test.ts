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
import { useNav } from "../src/store/navStore";

const store = useOnlineStore;

const screens = (): string[] => useNav.getState().stack.map((e) => e.name);

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
  await store.getState().quickMatch(2);
  expect(store.getState().status).toBe("lobby");
  expect(store.getState().isQuick).toBe(true);
  expect(store.getState().roomCode).toBeNull();
}

afterEach(() => {
  store.getState().leave();
  useNav.getState().reset("home");
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

    await store.getState().quickMatch(2);
    expect(store.getState().status).toBe("active");
    expect(store.getState().state).toEqual(dealt);
  });

  it("searching from the Home setup sheet stacks the lobby over the hub", async () => {
    vi.useFakeTimers();
    await startSearch();

    // The sheet lives on Home, so back from the search lands on the hub.
    expect(screens()).toEqual(["home", "lobby"]);

    vi.mocked(api.quickBotFill).mockResolvedValue({ state: dealtGame(), v: 1 });
    await vi.advanceTimersByTimeAsync(PAST_FILL_MS);
    expect(screens()).toEqual(["home", "onlineGame"]);
  });

  it("an instant pairing from the sheet goes straight to the game", async () => {
    vi.mocked(api.quickMatch).mockResolvedValue({
      gameId: "g1",
      userId: "u2",
      myPlayerId: "p2",
      state: dealtGame(),
      v: 1,
    });
    vi.mocked(api.subscribeGame).mockImplementation((_gameId, handlers) => {
      subs = handlers;
      return {} as RealtimeChannel;
    });

    await store.getState().quickMatch(2);
    expect(screens()).toEqual(["home", "onlineGame"]);
  });

  it("threads the chosen stake tier through to the API, and omits it by default", async () => {
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

    await store.getState().quickMatch(2, 1000);
    expect(api.quickMatch).toHaveBeenLastCalledWith(2, 1000);
    expect(store.getState().stake).toBe(0); // server response above carried none

    await store.getState().quickMatch(4);
    expect(api.quickMatch).toHaveBeenLastCalledWith(4, undefined);
  });

  it("a 4-player search remembers its size and still bot-fills the table", async () => {
    vi.useFakeTimers();
    vi.mocked(api.quickMatch).mockResolvedValue({
      gameId: "g1",
      userId: "u1",
      myPlayerId: "p1",
      waiting: true,
      size: 4,
    });
    vi.mocked(api.subscribeGame).mockImplementation((_gameId, handlers) => {
      subs = handlers;
      return {} as RealtimeChannel;
    });

    await store.getState().quickMatch(4);
    expect(store.getState().status).toBe("lobby");
    expect(store.getState().quickSize).toBe(4);

    const dealt = dealtGame();
    vi.mocked(api.quickBotFill).mockResolvedValue({ state: dealt, v: 1 });
    await vi.advanceTimersByTimeAsync(PAST_FILL_MS);
    expect(api.quickBotFill).toHaveBeenCalledTimes(1);
    expect(store.getState().status).toBe("active");
  });
});
