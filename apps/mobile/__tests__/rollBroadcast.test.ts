/**
 * Receiving a die that arrived over broadcast rather than in a state write.
 *
 * On a folding table the server stops writing the roll: the die goes out as a
 * ~60 byte broadcast, and the next state write carries the die AND the move
 * together. Spectators must animate the die the moment the broadcast lands —
 * which is when it landed before — and must NOT animate it a second time when
 * the folded state push arrives behind it.
 *
 * `rollSeq` is the animation trigger and `rollBumped` is the existing one-shot
 * flag that swallows a state's bump when the client already animated. The
 * broadcast reuses exactly that mechanism.
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

function freshGame(): GameState {
  return createGame([P1, P2], { gameId: "g1" });
}

function row(state: GameState, v: number): api.GameRow {
  return {
    id: "g1",
    room_code: "ABCD",
    host_user_id: "u2",
    status: state.status === "finished" ? "finished" : "active",
    state,
    current_turn_player_id: state.currentTurnPlayerId,
    state_version: v,
  };
}

let subs: api.GameSubscription;

/** Join g1 as u2/p2 — the SPECTATOR seat, watching p1 roll. */
async function joinAsSpectator(state: GameState, v = 1): Promise<void> {
  vi.mocked(api.joinGame).mockResolvedValue({
    gameId: "g1",
    roomCode: "ABCD",
    userId: "u2",
    myPlayerId: "p2",
  });
  vi.mocked(api.fetchGame).mockResolvedValue(row(state, v));
  vi.mocked(api.subscribeGame).mockImplementation((_gameId, handlers) => {
    subs = handlers;
    return {} as RealtimeChannel;
  });
  await store.getState().join("ABCD");
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  store.getState().leave();
  // clear (not restore): restoring would strip the module mocks' implementations
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("die broadcast", () => {
  it("animates the die when a roll broadcast arrives", async () => {
    await joinAsSpectator(freshGame(), 1);
    const before = store.getState().rollSeq;

    subs.onRoll?.({ die: 5, playerId: "p1", v: 1 });
    await flush();

    expect(store.getState().lastRoll).toBe(5);
    expect(store.getState().rollSeq).toBe(before + 1);
  });

  it("does not double-animate when the folded state push follows", async () => {
    await joinAsSpectator(freshGame(), 1);

    subs.onRoll?.({ die: 6, playerId: "p1", v: 1 });
    await flush();
    const afterBroadcast = store.getState().rollSeq;

    // The folded write lands: it carries the same die plus the resulting move.
    const folded = rollDice(freshGame(), () => 0.99).newState;
    subs.onGame(row(folded, 2));
    await flush();

    expect(store.getState().rollSeq).toBe(afterBroadcast);
  });

  it("still animates from state alone when no broadcast arrived", async () => {
    // An unfolded table, or a broadcast that was dropped: the state write is
    // authoritative and must still produce the animation on its own.
    await joinAsSpectator(freshGame(), 1);
    const before = store.getState().rollSeq;

    const rolled = rollDice(freshGame(), () => 0.99).newState;
    subs.onGame(row(rolled, 2));
    await flush();

    expect(store.getState().rollSeq).toBe(before + 1);
  });

  it("ignores a broadcast for a version already left behind", async () => {
    await joinAsSpectator(freshGame(), 3);
    const before = store.getState().rollSeq;

    // A straggler from two turns ago must not re-trigger the die.
    subs.onRoll?.({ die: 2, playerId: "p1", v: 1 });
    await flush();

    expect(store.getState().rollSeq).toBe(before);
  });
});
