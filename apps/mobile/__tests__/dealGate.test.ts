/**
 * The cover over a freshly dealt table, and the one property that matters about
 * it: IT ALWAYS LIFTS.
 *
 * It exists because the opening roll's die prefetch is the one least likely to
 * have landed — the request is queued behind everything a new game screen starts
 * — so a player could be handed a die that could not answer yet. But what it
 * waits on is an optimisation, and optimisations fail: no key configured, an old
 * server, a request that never returns. Every one of those has to end with a
 * playable board, so every route out is pinned here rather than just the happy
 * one.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { createGame, type GameState } from "@ludo/engine";
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

/** Join g1 as `me`. p1 is seated first, so p1 is the seat that opens the game. */
async function join(state: GameState, me: { userId: string; playerId: string }): Promise<void> {
  vi.mocked(api.joinGame).mockResolvedValue({
    gameId: "g1",
    roomCode: "ABCD",
    userId: me.userId,
    myPlayerId: me.playerId,
  });
  vi.mocked(api.fetchGame).mockResolvedValue(row(state, 1));
  vi.mocked(api.subscribeGame).mockImplementation(() => ({}) as RealtimeChannel);
  await store.getState().join("ABCD");
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const fresh = () => createGame([P1, P2], { gameId: "g1" });

afterEach(() => {
  store.getState().leave();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("the dealing cover", () => {
  it("lifts once the opening die is armed", async () => {
    vi.mocked(api.prepareRoll).mockResolvedValue({ v: 1, dice: 4 });
    await join(fresh(), { userId: "u1", playerId: "p1" });
    await flush();
    await flush();
    expect(store.getState().dealing).toBe(false);
  });

  it("never goes up for a seat that is not opening the game", async () => {
    // There is no die to wait for, so covering the board would be a wait for
    // nothing — and would sit there for the whole timeout.
    vi.mocked(api.prepareRoll).mockResolvedValue(null);
    await join(fresh(), { userId: "u2", playerId: "p2" });
    await flush();
    expect(store.getState().dealing).toBe(false);
  });

  it("lifts when the prefetch answers with nothing", async () => {
    // No DICE_SECRET configured, or a server too old to know the op. The roll
    // simply takes the slow path, which is allowed — the board must not stay
    // covered over it.
    vi.mocked(api.prepareRoll).mockResolvedValue(null);
    await join(fresh(), { userId: "u1", playerId: "p1" });
    await flush();
    await flush();
    expect(store.getState().dealing).toBe(false);
  });

  it("lifts when the prefetch rejects", async () => {
    vi.mocked(api.prepareRoll).mockRejectedValue(new Error("offline"));
    await join(fresh(), { userId: "u1", playerId: "p1" });
    await flush();
    await flush();
    expect(store.getState().dealing).toBe(false);
  });

  it("lifts on its own when the answer never comes at all", async () => {
    // THE ONE THAT MATTERS. A request that neither resolves nor rejects must not
    // leave somebody looking at a loading screen for the rest of the game.
    vi.useFakeTimers();
    vi.mocked(api.prepareRoll).mockReturnValue(new Promise(() => {}));
    await join(fresh(), { userId: "u1", playerId: "p1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().dealing).toBe(true);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(store.getState().dealing).toBe(false);
  });

  it("does not survive leaving the table", async () => {
    vi.mocked(api.prepareRoll).mockReturnValue(new Promise(() => {}));
    await join(fresh(), { userId: "u1", playerId: "p1" });
    await flush();
    expect(store.getState().dealing).toBe(true);
    store.getState().leave();
    expect(store.getState().dealing).toBe(false);
  });
});
