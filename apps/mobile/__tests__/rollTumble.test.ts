/**
 * One roll, one tumble.
 *
 * `rollSeq` is the only thing that starts the die animation: Dice.tsx restarts
 * its tumble (and plays the rattle) whenever the number changes. So a roll that
 * bumps it twice is a die that visibly rolls twice for one throw — the
 * "it keeps re-rolling, like it's glitching" the players are reporting, with a
 * doubled rattle on top of it.
 *
 * On a folding table an opponent's roll arrives as a BROADCAST first and the
 * state that explains it later, so two different producers can bump: the
 * broadcast, and the state. `rollBumped` is what stops them both counting the
 * same roll — the broadcast sets it, and the arriving state spends it.
 *
 * These tests pin that accounting across the interleavings the row queue
 * actually produces. The queue paces states by their animation time, so under
 * any lag at all a SECOND broadcast can land while the FIRST state is still
 * waiting its turn — which is routine, because a six grants another roll.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  applyMove,
  createGame,
  getValidMoves,
  rollDice,
  type GameState,
} from "@ludo/engine";
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
import { BUST_HOLD_MS } from "../src/lib/projection";

const store = useOnlineStore;

const P1 = { id: "p1", userId: "u1", color: "red" as const };
const P2 = { id: "p2", userId: "u2", color: "yellow" as const };

function freshGame(): GameState {
  return createGame([P1, P2], { gameId: "g1" });
}

/** p1 has rolled a 6: awaiting-move with entry moves for every yard token. */
function rolledSix(): GameState {
  return rollDice(freshGame(), () => 0.99).newState;
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Realtime handlers captured from the store's subscribe call. */
let subs: api.GameSubscription;

/** Join game g1 as u1/p1 with `state` on the wire at version `v`. */
async function joinActiveGame(state: GameState, v = 1): Promise<void> {
  vi.mocked(api.getLobby).mockResolvedValue([]);
  vi.mocked(api.getProfiles).mockResolvedValue([]);
  vi.mocked(api.upsertMyProfile).mockResolvedValue(null);
  vi.mocked(api.setConnected).mockResolvedValue(undefined);
  vi.mocked(api.leaveAction).mockResolvedValue(undefined);
  vi.mocked(api.joinGame).mockResolvedValue({
    gameId: "g1",
    roomCode: "ABCD",
    userId: "u1",
    myPlayerId: "p1",
  });
  vi.mocked(api.fetchGame).mockResolvedValue(row(state, v));
  vi.mocked(api.subscribeGame).mockImplementation((_gameId, handlers) => {
    subs = handlers;
    return {} as RealtimeChannel;
  });
  await store.getState().join("ABCD");
  expect(store.getState().state).toEqual(state);
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Realtime rows are applied one at a time, each waiting out the previous
 *  state's board animation — so a queued state needs real time, not a tick. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 1500));

/**
 * A state as Postgres hands it back, rather than as the engine built it.
 *
 * `games.state` is jsonb, which does not store key order — it sorts keys by
 * length, then bytewise. So the realtime row and the resync fetch carry a
 * DIFFERENT key order from the HTTP response of the very same write, and
 * reconciliation compares states with JSON.stringify.
 */


/** Every rollSeq the store passed through, in order. */
function watchRollSeq(): { seqs: number[]; stop: () => void } {
  const seqs: number[] = [store.getState().rollSeq];
  const stop = store.subscribe((s) => {
    if (s.rollSeq !== seqs[seqs.length - 1]) seqs.push(s.rollSeq);
  });
  return { seqs, stop };
}

/** How many times the die was told to tumble. */
const tumbles = (seqs: number[]) => seqs.length - 1;

afterEach(() => {
  vi.useRealTimers();
  store.getState().leave();
});

describe("an opponent's roll tumbles the die exactly once", () => {
  it("counts one roll when the broadcast is followed by its state", async () => {
    // p2 to play, so their roll reaches us as a broadcast + a folded state.
    const start = { ...freshGame(), currentTurnPlayerId: "p2" };
    await joinActiveGame(start, 1);
    const watch = watchRollSeq();

    subs.onRoll!({ die: 6, playerId: "p2", v: 1 });
    const rolled = rollDice(start, () => 0.99).newState;
    subs.onGame(row(rolled, 2));
    await flush();

    expect(tumbles(watch.seqs)).toBe(1);
    watch.stop();
  });

  it("counts TWO rolls when a second broadcast lands before the first state applies", async () => {
    // A six grants another roll, so the folded states are roll+move pairs and a
    // second broadcast routinely arrives while the first is still being paced.
    const start = { ...freshGame(), currentTurnPlayerId: "p2" };
    await joinActiveGame(start, 1);
    const watch = watchRollSeq();

    const r1 = rollDice(start, () => 0.99).newState;
    const moved1 = applyMove(r1, { tokenId: getValidMoves(r1, "p2")[0]!.tokenId });
    const r2 = rollDice(moved1, () => 0.99).newState;
    const moved2 = applyMove(r2, { tokenId: getValidMoves(r2, "p2")[0]!.tokenId });

    subs.onRoll!({ die: 6, playerId: "p2", v: 1 });
    subs.onRoll!({ die: 6, playerId: "p2", v: 2 });
    subs.onGame(row(moved1, 2));
    subs.onGame(row(moved2, 3));
    await settle();

    expect(tumbles(watch.seqs)).toBe(2);
    watch.stop();
  });

  it("does not swallow a later roll because a folded one left the flag set", async () => {
    // The flag `receiveRoll` sets is spent by an arriving state that ROLLED —
    // but a folded state carries no diceValue, so it never counts as one and
    // never spends it. Left set, it is the NEXT genuine roll that gets
    // swallowed: a number that appears on a die sitting perfectly still.
    const start = { ...freshGame(), currentTurnPlayerId: "p2" };
    await joinActiveGame(start, 1);

    // p2 rolls on a folding table: broadcast, then the folded roll+move state.
    const r1 = rollDice(start, () => 0.99).newState;
    const moved1 = applyMove(r1, { tokenId: getValidMoves(r1, "p2")[0]!.tokenId });
    subs.onRoll!({ die: 6, playerId: "p2", v: 1 });
    subs.onGame(row(moved1, 2));
    await settle();

    const watch = watchRollSeq();
    // Now an UNFOLDED roll arrives as its own state — no broadcast preceded it.
    const handed = { ...moved1, currentTurnPlayerId: "p2" };
    subs.onGame(row(rollDice(handed, () => 0.5).newState, 3));
    await settle();

    expect(tumbles(watch.seqs)).toBe(1);
    watch.stop();
  });

  it("still tumbles for a state whose roll was never broadcast", async () => {
    // An unfolded table, or a broadcast lost in a socket gap: the state is the
    // only notice we get, so it must bump on its own.
    const start = { ...freshGame(), currentTurnPlayerId: "p2" };
    await joinActiveGame(start, 1);
    const watch = watchRollSeq();

    subs.onGame(row(rollDice(start, () => 0.99).newState, 2));
    await flush();

    expect(tumbles(watch.seqs)).toBe(1);
    watch.stop();
  });
});
