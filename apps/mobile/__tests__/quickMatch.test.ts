/**
 * Quick match: queue, labelled-bot fill timer, and the races around it.
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
  leaveAction: vi.fn().mockResolvedValue({cancelled:true}),
  warmUp: vi.fn(),
  getLobby: vi.fn().mockResolvedValue([]),
  lobbyEqual: (a: unknown[], b: unknown[]) =>
    a.length === b.length && a.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i])),
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

afterEach(async () => {
  vi.mocked(api.leaveAction).mockResolvedValue({cancelled:true});
  await store.getState().leave();
  useNav.getState().reset("home");
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("online modes", () => {
  it("asks the server for Blitz, and remembers it for the lobby", async () => {
    vi.mocked(api.quickMatch).mockResolvedValue({ gameId: "g1", userId: "u1", myPlayerId: "p1", waiting: true, mode: "blitz" });
    vi.mocked(api.subscribeGame).mockReturnValue({} as RealtimeChannel);

    await store.getState().quickMatch(2, 100, "blitz");

    expect(api.quickMatch).toHaveBeenCalledWith(2, 100, "blitz");
    expect(store.getState().mode).toBe("blitz");
  });

  it("believes the server over the request", async () => {
    // A re-tap while already searching hands back the room you are in, whatever
    // you asked for this time, so the lobby must show what that room really is.
    vi.mocked(api.quickMatch).mockResolvedValue({ gameId: "g1", userId: "u1", myPlayerId: "p1", waiting: true, mode: "classic" });
    vi.mocked(api.subscribeGame).mockReturnValue({} as RealtimeChannel);

    await store.getState().quickMatch(2, 100, "blitz");

    expect(store.getState().mode).toBe("classic");
  });

  it("creates a Blitz room, and forgets the mode on leaving", async () => {
    vi.mocked(api.createGame).mockResolvedValue({ gameId: "g1", roomCode: "ABCD", userId: "u1", myPlayerId: "p1", mode: "blitz" });
    vi.mocked(api.subscribeGame).mockReturnValue({} as RealtimeChannel);

    await store.getState().create(0, "blitz");
    expect(api.createGame).toHaveBeenCalledWith(0, "blitz");
    expect(store.getState().mode).toBe("blitz");

    await store.getState().leave();
    expect(store.getState().mode).toBe("classic");
  });

  it("learns the mode of a room it joins by code", async () => {
    vi.mocked(api.joinGame).mockResolvedValue({ gameId: "g1", roomCode: "ABCD", userId: "u1", myPlayerId: "p2", mode: "blitz" });
    vi.mocked(api.subscribeGame).mockReturnValue({} as RealtimeChannel);
    vi.mocked(api.fetchGame).mockResolvedValue({ ...row(dealtGame(), 0), status: "waiting", state: null } as unknown as api.GameRow);

    await store.getState().join("ABCD");

    expect(store.getState().mode).toBe("blitz");
  });
});

describe("quick match", () => {
  it("fills with a labelled bot after the wait window", async () => {
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

    await store.getState().leave();
    await vi.advanceTimersByTimeAsync(PAST_FILL_MS);

    expect(api.quickBotFill).not.toHaveBeenCalled();
    expect(api.leaveAction).toHaveBeenCalledWith("g1", true);
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

describe("search cancellation", () => {
  it("keeps the lobby and surfaces a failed refund instead of claiming cancellation succeeded", async () => {
    vi.useFakeTimers(); await startSearch();
    vi.mocked(api.leaveAction).mockRejectedValueOnce(new Error("Could not cancel. Try again."));
    await store.getState().leave();
    expect(store.getState().gameId).toBe("g1");
    expect(store.getState().error).toContain("Could not cancel");
    await vi.advanceTimersByTimeAsync(PAST_FILL_MS);
    expect(api.quickBotFill).not.toHaveBeenCalled();
  });
  it("keeps an already-started match when cancellation loses the race", async () => {
    vi.useFakeTimers(); await startSearch();
    vi.mocked(api.leaveAction).mockResolvedValueOnce({cancelled:false,state:dealtGame(),v:2});
    await store.getState().leave();
    expect(store.getState().status).toBe("active");
    expect(store.getState().gameId).toBe("g1");
    expect(screens().at(-1)).toBe("onlineGame");
  });
  it("waits for the refund transaction before returning home", async () => {
    vi.useFakeTimers(); await startSearch();
    let resolve!: (value: {cancelled:boolean}) => void;
    vi.mocked(api.leaveAction).mockReturnValueOnce(new Promise(r=>{resolve=r;}));
    const leaving=store.getState().leave();
    expect(store.getState().status).toBe("lobby");
    resolve({cancelled:true}); await leaving;
    expect(store.getState().gameId).toBeNull();expect(screens().at(-1)).toBe("home");
  });
});

it("retries a failed fill while the same search is still waiting", async () => {
  vi.useFakeTimers(); await startSearch();
  vi.mocked(api.fetchGame).mockResolvedValue({...row(dealtGame(),1),status:"waiting",state:null});
  vi.mocked(api.quickBotFill).mockRejectedValueOnce(new Error("seats changed")).mockResolvedValue({state:dealtGame(),v:2});
  await vi.advanceTimersByTimeAsync(PAST_FILL_MS*2);
  expect(api.quickBotFill).toHaveBeenCalledTimes(2);
  expect(store.getState().status).toBe("active");
});

it("ignores a fill response that arrives after confirmed cancellation", async () => {
  vi.useFakeTimers(); await startSearch();
  let resolve!: (value: {state:GameState;v:number}) => void;
  vi.mocked(api.quickBotFill).mockReturnValueOnce(new Promise(r=>{resolve=r;}));
  await vi.advanceTimersByTimeAsync(PAST_FILL_MS);
  await store.getState().leave();
  resolve({state:dealtGame(),v:2});await vi.advanceTimersByTimeAsync(1);
  expect(store.getState().gameId).toBeNull();
  expect(screens().at(-1)).toBe("home");
});

it("a search-screen cancel stays cancellation-only after realtime activates the match", async () => {
  vi.useFakeTimers(); await startSearch();
  subs.onGame(row(dealtGame(),2));await vi.advanceTimersByTimeAsync(1);
  expect(store.getState().status).toBe("active");
  vi.mocked(api.leaveAction).mockResolvedValueOnce({cancelled:false,state:dealtGame(),v:2});
  await store.getState().leave(true);
  expect(api.leaveAction).toHaveBeenCalledWith("g1",true);
  expect(store.getState().status).toBe("active");
  expect(store.getState().gameId).toBe("g1");
});
it("an empty cancellation response cannot silently discard the paid search", async () => {
  vi.useFakeTimers(); await startSearch();
  vi.mocked(api.leaveAction).mockResolvedValueOnce(undefined);
  await store.getState().leave(true);
  expect(store.getState().gameId).toBe("g1");
  expect(store.getState().error).toContain("confirm cancellation");
});
