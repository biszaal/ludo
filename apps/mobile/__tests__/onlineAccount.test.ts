/**
 * The online table is torn down when the signed-in user changes.
 *
 * Sign-in, sign-out and account deletion replace the session in place. The
 * store used to keep the previous game's channel, timers and id, and the next
 * call went out as the new user. These tests drive that through the auth
 * listener and show the old game is not named again.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { createGame, type GameState } from "@ludo/engine";
import type { RealtimeChannel } from "@supabase/supabase-js";

const h = vi.hoisted(() => ({
  listeners: [] as Array<
    (event: string, session: { user: { id: string }; refresh_token: string } | null) => void
  >,
}));

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
  quickMatch: vi.fn(),
  quickBotFill: vi.fn(),
  TimeoutError: class TimeoutError extends Error {},
  RowGoneError: class RowGoneError extends Error {},
  isTimeout: (e: unknown) => e instanceof Error && e.name === "TimeoutError",
}));

vi.mock("../src/lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      onAuthStateChange: (cb: (typeof h.listeners)[number]) => {
        h.listeners.push(cb);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      getSession: async () => ({ data: { session: null } }),
    },
  }),
}));

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK: "after",
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));

vi.mock("../src/lib/crashReporting", () => ({ setCrashUser: vi.fn() }));

import * as api from "../src/net/api";
import { useOnlineStore } from "../src/store/onlineStore";
import { useNav } from "../src/store/navStore";
import { OnlineAccount } from "../src/lib/onlineAccount";
import { getIdentity } from "../src/lib/identityClient";

const channel = { topic: "game" } as RealtimeChannel;

function session(userId: string) {
  return { user: { id: userId }, refresh_token: `refresh-${userId}` };
}

function emit(event: string, userId: string | null): void {
  const cb = h.listeners[0];
  if (!cb) throw new Error("auth listener was not registered");
  cb(event, userId ? session(userId) : null);
}

function row(state: GameState, id: string, v: number): api.GameRow {
  return {
    id,
    room_code: "ABCD",
    host_user_id: "u2",
    status: "active",
    state,
    current_turn_player_id: state.currentTurnPlayerId,
    state_version: v,
  };
}

async function joinGame(gameId: string, userId: string): Promise<GameState> {
  const state = createGame(
    [
      { id: "p1", userId, color: "red" },
      { id: "p2", userId: "opponent", color: "yellow" },
    ],
    { gameId },
  );
  vi.mocked(api.joinGame).mockResolvedValue({
    gameId,
    roomCode: "ABCD",
    userId,
    myPlayerId: "p1",
  });
  vi.mocked(api.fetchGame).mockResolvedValue(row(state, gameId, 1));
  vi.mocked(api.subscribeGame).mockReturnValue(channel);
  await useOnlineStore.getState().join("ABCD");
  expect(useOnlineStore.getState().gameId).toBe(gameId);
  expect(useOnlineStore.getState().userId).toBe(userId);
  return state;
}

beforeEach(async () => {
  OnlineAccount.testingOnlyReset();
  await useOnlineStore.getState().leave();
  useNav.setState({ stack: [{ name: "home", key: "home" }], lastOp: "reset" });
  vi.clearAllMocks();
});

getIdentity();

afterEach(() => {
  vi.useRealTimers();
});

describe("an auth identity change", () => {
  it("stops calling the old game and will name a later one", async () => {
    vi.useFakeTimers();
    emit("SIGNED_IN", "u1");
    await joinGame("g-old", "u1");
    useNav.getState().push("account");
    expect(OnlineAccount.allows("g-old")).toBe(true);

    // Token refresh is the same account. The table stays.
    emit("TOKEN_REFRESHED", "u1");
    expect(useOnlineStore.getState().gameId).toBe("g-old");
    expect(api.unsubscribe).not.toHaveBeenCalled();

    void useOnlineStore.getState().resync();
    vi.mocked(api.fetchGame).mockClear();
    vi.mocked(api.timeoutAction).mockClear();
    vi.mocked(api.rollAction).mockClear();
    vi.mocked(api.setConnected).mockClear();
    vi.mocked(api.subscribeGame).mockClear();

    // Sign-out, then the fresh guest. Both are identity changes.
    emit("SIGNED_OUT", null);
    emit("SIGNED_IN", "u2");

    expect(useOnlineStore.getState().gameId).toBeNull();
    expect(useOnlineStore.getState().userId).toBeNull();
    expect(OnlineAccount.allows("g-old")).toBe(false);
    expect(api.unsubscribe).toHaveBeenCalledWith(channel);
    // Account stays on screen; the game underneath does not.
    expect(useNav.getState().stack.map((entry) => entry.name)).toEqual(["home", "account"]);

    await vi.advanceTimersByTimeAsync(60_000);
    await useOnlineStore.getState().roll();
    await useOnlineStore.getState().resync();

    expect(api.rollAction).not.toHaveBeenCalled();
    expect(api.timeoutAction).not.toHaveBeenCalled();
    expect(api.fetchGame).not.toHaveBeenCalled();
    expect(api.setConnected).not.toHaveBeenCalled();
    expect(api.subscribeGame).not.toHaveBeenCalled();

    vi.mocked(api.rollAction).mockResolvedValue({
      state: createGame(
        [
          { id: "p1", userId: "u2", color: "red" },
          { id: "p2", userId: "opponent", color: "yellow" },
        ],
        { gameId: "g-new" },
      ),
      v: 1,
    });
    await joinGame("g-new", "u2");
    await useOnlineStore.getState().roll();

    expect(OnlineAccount.allows("g-new")).toBe(true);
    expect(OnlineAccount.allows("g-old")).toBe(false);
    expect(api.rollAction).toHaveBeenCalledTimes(1);
    expect(api.rollAction).toHaveBeenCalledWith("g-new", expect.any(String));
    expect(api.subscribeGame).toHaveBeenCalledWith("g-new", expect.anything());
  });

  it("does not adopt a game whose entry outlived the account", async () => {
    emit("SIGNED_IN", "u1");
    let finishJoin: (value: Awaited<ReturnType<typeof api.joinGame>>) => void = () => {};
    vi.mocked(api.joinGame).mockReturnValue(
      new Promise((resolve) => {
        finishJoin = resolve;
      }),
    );

    const joining = useOnlineStore.getState().join("ABCD");
    emit("SIGNED_OUT", null);
    emit("SIGNED_IN", "u2");
    finishJoin({ gameId: "g-old", roomCode: "ABCD", userId: "u1", myPlayerId: "p1" });
    await joining;

    expect(useOnlineStore.getState().gameId).toBeNull();
    expect(api.subscribeGame).not.toHaveBeenCalled();
    expect(api.getLobby).not.toHaveBeenCalled();
    expect(OnlineAccount.allows("g-old")).toBe(false);
  });
});
