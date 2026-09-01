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
import { applyMove, createGame, endTurn, getValidMoves, rollDice, type GameState } from "@ludo/engine";
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
import { ROLL_PACING_MS } from "../src/lib/moveTiming";

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

/**
 * A broadcast has to be judged against the board the WATCHER is looking at.
 *
 * Under lag the row queue holds states back so each animation plays out, so
 * `lastAppliedV` and the state on screen both trail the server. The broadcast
 * used to be applied the instant it arrived and checked against those stale
 * values, which produced the two complaints this suite now pins: an opponent's
 * next die tumbling on top of the hop still playing out, and a roll that handed
 * over to another seat being dropped on the floor.
 */
describe("die broadcast pacing", () => {
  /**
   * One turn as a folding table writes it: the roll and whatever resolves it,
   * folded into a single state. A non-six with every pawn still in the yard has
   * no legal move at all, so that turn resolves as a PASS — which is the ordinary
   * way an early turn hands over.
   */
  function foldedTurn(from: GameState, rng: () => number): { rolled: GameState; folded: GameState } {
    const rolled = rollDice(from, rng).newState;
    const moves = getValidMoves(rolled, rolled.currentTurnPlayerId);
    const folded = moves.length > 0 ? applyMove(rolled, { tokenId: moves[0]!.tokenId }) : endTurn(rolled);
    return { rolled, folded };
  }

  it("waits for the tumble it started before letting the move state land", async () => {
    vi.useFakeTimers();
    await joinAsSpectator(freshGame(), 1);

    subs.onRoll?.({ die: 6, playerId: "p1", v: 1 });
    const { folded } = foldedTurn(freshGame(), () => 0.99);
    // The roller's device answers immediately, so the state chases the die home.
    subs.onGame(row(folded, 2));

    // Still the pre-roll board: the tumble owns the screen for its own length.
    expect(store.getState().state?.tokens).toEqual(freshGame().tokens);
    expect(store.getState().lastRoll).toBe(6);

    await vi.advanceTimersByTimeAsync(ROLL_PACING_MS + 20);
    expect(store.getState().state?.tokens).not.toEqual(freshGame().tokens);
  });

  it("holds a broadcast for a board it has not caught up to, then plays it", async () => {
    // p1 rolls a six, moves, and rolls again — all before the watcher has
    // finished animating the first move. The second broadcast describes version
    // 2, which this client has not applied yet.
    vi.useFakeTimers();
    await joinAsSpectator(freshGame(), 1);

    const first = foldedTurn(freshGame(), () => 0.99); // a six keeps the turn
    expect(first.folded.currentTurnPlayerId).toBe("p1");

    subs.onRoll?.({ die: 6, playerId: "p1", v: 1 });
    const afterFirst = store.getState().rollSeq;
    subs.onRoll?.({ die: 3, playerId: "p1", v: 2 });
    subs.onGame(row(first.folded, 2));

    // The second die must NOT have started: version 2 is not on screen yet.
    expect(store.getState().rollSeq).toBe(afterFirst);
    expect(store.getState().lastRoll).toBe(6);

    // First tumble, then the move it explains, then the second tumble.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(store.getState().rollSeq).toBe(afterFirst + 1);
    expect(store.getState().lastRoll).toBe(3);
  });

  it("does not drop a roll whose seat the watcher has not caught up to", async () => {
    // Seated third so the hand-off goes to somebody who is neither the stale
    // current player nor us: turn order follows the seat list, so p1 -> p3 -> p2,
    // and we are p2.
    vi.useFakeTimers();
    const P3 = { id: "p3", userId: "u3", color: "green" as const };
    const three = createGame([P1, P3, P2], { gameId: "g1" });
    await joinAsSpectator(three, 1);

    // p1 rolls a non-six with every pawn in the yard, so the turn passes.
    const { folded } = foldedTurn(three, () => 0.5);
    const handedTo = folded.currentTurnPlayerId;
    expect(handedTo).toBe("p3");

    // p1's tumble is still on screen when their pass state and p3's own roll
    // both arrive, so nothing here can be judged against the live board.
    subs.onRoll?.({ die: 4, playerId: "p1", v: 1 });
    subs.onGame(row(folded, 2));
    subs.onRoll?.({ die: 5, playerId: handedTo, v: 2 });

    // The old check asked "is this the current player?" of a state that still
    // said p1, and threw p3's roll away — and a folded state carries no die, so
    // nothing behind it re-tumbled either.
    const afterFirst = store.getState().rollSeq;
    expect(store.getState().lastRoll).toBe(4);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(store.getState().state?.currentTurnPlayerId).toBe("p3");
    expect(store.getState().rollSeq).toBe(afterFirst + 1);
    expect(store.getState().lastRoll).toBe(5);
  });

  it("animates BOTH rolls when two are parked before the board catches up", async () => {
    // The dropped-turn bug, and it needs two rolls parked AT THE SAME TIME to
    // show up — which is the ordinary case on a link slow enough to need this
    // pacing, because the rolls and the writes that resolve them are all in
    // flight together. A single pending slot let the newer broadcast overwrite
    // the older one, and that seat's roll was never animated at all: its own
    // resolving write is a folded state carrying no die, so nothing behind it
    // re-tumbled either.
    vi.useFakeTimers();
    // Turn order follows the colour cycle — red, green, yellow, blue — not the
    // seat list, so we take BLUE and let two opponents play in a row ahead of us.
    const P3 = { id: "p3", userId: "u3", color: "green" as const };
    const P4 = { id: "p4", userId: "u4", color: "yellow" as const };
    const ME = { id: "p2", userId: "u2", color: "blue" as const };
    const four = createGame([P1, P3, P4, ME], { gameId: "g1" });
    await joinAsSpectator(four, 1);

    const one = foldedTurn(four, () => 0.5); // p1 -> p3
    const two = foldedTurn(one.folded, () => 0.5); // p3 -> p4
    expect(one.folded.currentTurnPlayerId).toBe("p3");
    expect(two.folded.currentTurnPlayerId).toBe("p4");

    // p1's turn lands and starts animating, which is what puts the watcher
    // behind for everything that follows.
    subs.onGame(row(one.folded, 2));
    const before = store.getState().rollSeq;

    // Now both of the next two rolls arrive while that animation is still
    // running, so both have to wait — together.
    subs.onRoll?.({ die: 2, playerId: "p3", v: 2 });
    subs.onGame(row(two.folded, 3));
    subs.onRoll?.({ die: 5, playerId: "p4", v: 3 });

    await vi.advanceTimersByTimeAsync(60_000);
    // Two seats rolled, so the die tumbled twice. One bump here means a player's
    // turn went by with no animation at all.
    expect(store.getState().rollSeq).toBe(before + 2);
    expect(store.getState().lastRoll).toBe(5);
  });

  it("drops a parked broadcast the board has since moved past", async () => {
    vi.useFakeTimers();
    await joinAsSpectator(freshGame(), 1);

    // A roll for version 5, which this table never reaches in the shape the
    // broadcast describes — a resync jumps us straight past it instead.
    const before = store.getState().rollSeq;
    subs.onRoll?.({ die: 2, playerId: "p1", v: 5 });
    expect(store.getState().rollSeq).toBe(before); // parked, not played

    const { folded } = foldedTurn(freshGame(), () => 0.5);
    subs.onGame(row(folded, 9));
    await vi.advanceTimersByTimeAsync(20_000);

    expect(store.getState().rollSeq).toBe(before);
  });
});
