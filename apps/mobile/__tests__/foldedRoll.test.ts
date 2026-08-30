/**
 * A folding table's roll comes back at the SAME version it was sent at.
 *
 * On a folding table (games.fold_writes) the server does not write the roll —
 * it derives the die, broadcasts ~60 bytes, and answers the roll op with the
 * rolled state at the UNCHANGED state_version, leaving both transitions for the
 * move/pass write that follows. So the roll response is the one authoritative
 * answer in the whole protocol whose version does not advance, and the client
 * must not mistake it for a stale echo of a version it already has.
 *
 *   npm run test:app
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

const freshGame = (): GameState => createGame([P1, P2], { gameId: "g1" });

/** The state the server hands back for a folded roll of `die`. */
const rolled = (die: number): GameState =>
  rollDice(freshGame(), () => (die - 0.5) / 6).newState;

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

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let subs: api.GameSubscription;

/**
 * Sit at a folding table with the prefetched die already in hand: joined as
 * u1/p1, our turn, awaiting-roll at version `v`, and prepareRoll answering with
 * `die` for that same version — the ordinary online case since 1.0.3.
 */
async function seatWithPreparedDie(die: number | null, v = 1): Promise<void> {
  const state = freshGame();
  vi.mocked(api.joinGame).mockResolvedValue({
    gameId: "g1",
    roomCode: "ABCD",
    userId: "u1",
    myPlayerId: "p1",
  });
  vi.mocked(api.fetchGame).mockResolvedValue(row(state, v));
  vi.mocked(api.prepareRoll).mockResolvedValue(die === null ? null : { v, dice: die });
  vi.mocked(api.subscribeGame).mockImplementation((_gameId, handlers) => {
    subs = handlers;
    return {} as RealtimeChannel;
  });
  await store.getState().join("ABCD");
  await flush();
  expect(store.getState().state?.phase).toBe("awaiting-roll");
}

afterEach(() => {
  store.getState().leave();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("a folded roll (same version back)", () => {
  it("lets the player move afterwards", async () => {
    await seatWithPreparedDie(6);
    // The fold: no write, so the answer carries the SAME version it was sent at.
    vi.mocked(api.rollAction).mockResolvedValue({ state: rolled(6), v: 1, folded: true });
    vi.mocked(api.moveAction).mockImplementation(async (_g, tokenId) => ({
      state: rolled(6),
      v: 2,
      duplicate: false,
    }));

    await store.getState().roll();
    await flush();

    const tokenId = store.getState().validMoves[0]?.tokenId;
    expect(tokenId).toBeDefined();
    await store.getState().selectToken(tokenId!);
    expect(api.moveAction).toHaveBeenCalled();
  });

  it("auto-passes a roll with no legal move", async () => {
    await seatWithPreparedDie(3); // everyone still in the yard: nothing to move
    // Only now: the join above awaits real promises that fake timers would hang.
    vi.useFakeTimers();
    vi.mocked(api.rollAction).mockResolvedValue({ state: rolled(3), v: 1, folded: true });
    vi.mocked(api.passAction).mockResolvedValue({ state: rolled(3), v: 2, duplicate: false });

    await store.getState().roll();
    expect(store.getState().validMoves).toEqual([]);

    await vi.advanceTimersByTimeAsync(2000);
    expect(api.passAction).toHaveBeenCalled();
  });

  it("lands the die when the prefetch never arrived", async () => {
    // No prepared number, so the tap starts a tumble on nothing and the roll's
    // own answer is what has to stop it. Dropped as stale, the die spins on.
    await seatWithPreparedDie(null); // the prefetch answered "not available"
    const server = rolled(6);
    vi.mocked(api.rollAction).mockResolvedValue({ state: server, v: 1, folded: true });

    await store.getState().roll();
    await flush();

    expect(store.getState().state?.phase).toBe("awaiting-move");
    expect(store.getState().lastRoll).toBe(6);
  });
});
