/**
 * The countdown ring must not leak how the server classified a seat.
 *
 * The server hands a SHORT turn_deadline to seats it drives or has given up on:
 * 12s while a bot is playing, 6s for a human it knows is away. Both are
 * internal resilience numbers — they decide how soon the table may be resumed,
 * nothing more. Drawn literally, they turn the ring into a bot detector: a
 * quick-match fill-in is deliberately never flagged to the client (its
 * camouflage depends on that), yet its ring swept two and a half times faster
 * than a human's and gave the whole disguise away.
 *
 * So: the ring shows the full turn length for every window this client watched
 * open, while the skip it arms still fires on the server's real deadline.
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
import { TURN_SECONDS, useOnlineStore } from "../src/store/onlineStore";

const store = useOnlineStore;

const P1 = { id: "p1", userId: "u1", color: "red" as const };
const P2 = { id: "p2", userId: "u2", color: "yellow" as const };

/** p1's turn, awaiting-roll. */
function myTurn(): GameState {
  return createGame([P1, P2], { gameId: "g1" });
}

/** The same table with the turn handed to p2 — a fresh action window. */
function theirTurn(): GameState {
  return { ...myTurn(), currentTurnPlayerId: "p2" };
}

function row(state: GameState, v: number, deadlineSecs: number | null): api.GameRow {
  return {
    id: "g1",
    room_code: "ABCD",
    host_user_id: "u2",
    status: "active",
    state,
    current_turn_player_id: state.currentTurnPlayerId,
    state_version: v,
    turn_deadline: deadlineSecs == null ? null : new Date(Date.now() + deadlineSecs * 1000).toISOString(),
  } as api.GameRow;
}

/** Deliver a row the way realtime does, via the captured onGame handler. */
let onGame: ((row: api.GameRow) => void) | null = null;

async function joinActiveGame(state: GameState, deadlineSecs: number | null, v = 1): Promise<void> {
  vi.mocked(api.joinGame).mockResolvedValue({
    gameId: "g1",
    roomCode: "ABCD",
    userId: "u1",
    myPlayerId: "p1",
  });
  vi.mocked(api.fetchGame).mockResolvedValue(row(state, v, deadlineSecs));
  vi.mocked(api.subscribeGame).mockImplementation((_id, handlers: { onGame: (r: api.GameRow) => void }) => {
    onGame = handlers.onGame;
    return {} as RealtimeChannel;
  });
  await store.getState().join("ABCD");
}

afterEach(() => {
  store.getState().leave();
  onGame = null;
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("turn ring duration", () => {
  it("draws a full ring for a hand-off the server gave a bot's short clock", async () => {
    vi.useFakeTimers();
    await joinActiveGame(myTurn(), TURN_SECONDS);

    // The server hands the turn to a hidden bot: deadline 12s, not 30.
    onGame!(row(theirTurn(), 2, 12));

    // 12 would sweep 2.5x faster than our own ring and name the seat a bot.
    expect(store.getState().turnSeconds).toBe(TURN_SECONDS);
  });

  it("draws a full ring for a hand-off to a seat the server knows is away", async () => {
    vi.useFakeTimers();
    await joinActiveGame(myTurn(), TURN_SECONDS);

    onGame!(row(theirTurn(), 2, 6));

    expect(store.getState().turnSeconds).toBe(TURN_SECONDS);
  });

  it("still arms the skip on the server's real deadline, not the drawn one", async () => {
    vi.useFakeTimers();
    await joinActiveGame(myTurn(), TURN_SECONDS);
    vi.mocked(api.timeoutAction).mockResolvedValue({ state: theirTurn(), v: 3 } as never);

    onGame!(row(theirTurn(), 2, 12));

    // Real deadline 12s + grace + up to 2s jitter — well before the drawn 30.
    await vi.advanceTimersByTimeAsync(18_000);
    expect(api.timeoutAction).toHaveBeenCalled();
  });

  it("shows the time actually left when we arrive mid-window", async () => {
    vi.useFakeTimers();
    // Rejoining a turn already 22s old: the ring must not promise 30 more
    // seconds when the seat will be skipped in 8.
    await joinActiveGame(theirTurn(), 8);

    expect(store.getState().turnSeconds).toBe(8);
  });
});
