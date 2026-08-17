/**
 * Online store: optimistic actions + version-ordered reconciliation.
 *
 * The client predicts its own moves/passes with the shared engine and animates
 * them immediately; the server's write (arriving via HTTP response or realtime
 * echo, in either order) must confirm silently, and any racing write must snap
 * the client back to server truth. Versions (state_version) — not timing —
 * decide staleness.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
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
  rollAction: vi.fn(),
  moveAction: vi.fn(),
  passAction: vi.fn(),
  timeoutAction: vi.fn(),
  rematchAction: vi.fn(),
  leaveAction: vi.fn().mockResolvedValue(undefined),
  getLobby: vi.fn().mockResolvedValue([]),
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

afterEach(() => {
  store.getState().leave();
  // clear (not restore): restoring would strip the module mocks' implementations
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("optimistic moves", () => {
  it("applies the move locally before the server responds", async () => {
    const rolled = rolledSix();
    await joinActiveGame(rolled);
    const tokenId = store.getState().validMoves[0]!.tokenId;
    const predicted = applyMove(rolled, { tokenId });

    const d = deferred<api.TurnResult>();
    vi.mocked(api.moveAction).mockReturnValue(d.promise);

    const done = store.getState().selectToken(tokenId);
    // On screen immediately — no round trip.
    expect(store.getState().state).toEqual(predicted);

    d.resolve({ state: structuredClone(predicted), v: 2 });
    await done;
    expect(store.getState().state).toEqual(predicted);
    expect(store.getState().error).toBeNull();
  });

  it("confirms a matching response without re-applying (no countdown restart)", async () => {
    const rolled = rolledSix();
    await joinActiveGame(rolled);
    const tokenId = store.getState().validMoves[0]!.tokenId;
    const predicted = applyMove(rolled, { tokenId });

    const d = deferred<api.TurnResult>();
    vi.mocked(api.moveAction).mockReturnValue(d.promise);

    const done = store.getState().selectToken(tokenId);
    const turnSeqAfterOptimistic = store.getState().turnSeq;

    d.resolve({ state: structuredClone(predicted), v: 2 });
    await done;
    expect(store.getState().turnSeq).toBe(turnSeqAfterOptimistic);
  });

  it("confirms via the realtime echo when it beats the HTTP response", async () => {
    const rolled = rolledSix();
    await joinActiveGame(rolled);
    const tokenId = store.getState().validMoves[0]!.tokenId;
    const predicted = applyMove(rolled, { tokenId });

    const d = deferred<api.TurnResult>();
    vi.mocked(api.moveAction).mockReturnValue(d.promise);

    const done = store.getState().selectToken(tokenId);
    const turnSeqAfterOptimistic = store.getState().turnSeq;

    // Realtime delivers the echo of our own write first…
    subs.onGame(row(structuredClone(predicted), 2));
    expect(store.getState().turnSeq).toBe(turnSeqAfterOptimistic);

    // …and the late HTTP response is a stale no-op.
    d.resolve({ state: structuredClone(predicted), v: 2 });
    await done;
    expect(store.getState().state).toEqual(predicted);
    expect(store.getState().turnSeq).toBe(turnSeqAfterOptimistic);
  });

  it("snaps to server truth when the response disagrees with the prediction", async () => {
    const rolled = rolledSix();
    await joinActiveGame(rolled);
    const moves = getValidMoves(rolled, "p1");
    expect(moves.length).toBeGreaterThan(1);
    const tokenId = moves[0]!.tokenId;

    const d = deferred<api.TurnResult>();
    vi.mocked(api.moveAction).mockReturnValue(d.promise);

    const done = store.getState().selectToken(tokenId);

    // A racing write won (stall bot played a different token; our write
    // bounced off the version guard and the server returned the fresh row).
    const serverTruth = applyMove(rolled, { tokenId: moves[1]!.tokenId });
    d.resolve({ state: serverTruth, v: 2 });
    await done;
    expect(store.getState().state).toEqual(serverTruth);
  });
});

describe("slow connections", () => {
  const timeout = () => Object.assign(new Error("too long"), { name: "TimeoutError" });

  it("keeps the move on screen when the request times out", async () => {
    // The request is never aborted, so a timeout means "unknown", not "failed".
    // Rolling the pawn back here is what made a laggy match eat a move: it
    // snapped home, the player moved again, and the first write landed anyway.
    const rolled = rolledSix();
    await joinActiveGame(rolled);
    const tokenId = store.getState().validMoves[0]!.tokenId;
    const predicted = applyMove(rolled, { tokenId });

    vi.mocked(api.moveAction).mockRejectedValue(timeout());
    await store.getState().selectToken(tokenId);

    expect(store.getState().state).toEqual(predicted);
    expect(store.getState().error).toBeNull(); // nothing scary to show yet
  });

  it("settles silently when the slow write's echo finally arrives", async () => {
    const rolled = rolledSix();
    await joinActiveGame(rolled);
    const tokenId = store.getState().validMoves[0]!.tokenId;
    const predicted = applyMove(rolled, { tokenId });

    vi.mocked(api.moveAction).mockRejectedValue(timeout());
    await store.getState().selectToken(tokenId);
    const turnSeqAfterOptimistic = store.getState().turnSeq;

    // The write did land after all — its echo confirms what's already shown.
    subs.onGame(row(structuredClone(predicted), 2));
    expect(store.getState().state).toEqual(predicted);
    expect(store.getState().turnSeq).toBe(turnSeqAfterOptimistic);
  });

  it("still reverts immediately when the server actually rejects the move", async () => {
    const rolled = rolledSix();
    await joinActiveGame(rolled);
    const tokenId = store.getState().validMoves[0]!.tokenId;

    vi.mocked(api.moveAction).mockRejectedValue(new Error("Not your turn."));
    vi.mocked(api.fetchGame).mockResolvedValue(row(rolled, 1));
    await store.getState().selectToken(tokenId);

    expect(store.getState().error).toBe("Not your turn.");
  });
});

describe("version-ordered realtime rows", () => {
  it("skips stale rows instead of rewinding the board", async () => {
    vi.useFakeTimers();
    const base = freshGame();
    await joinActiveGame(base, 1);

    const newer = rollDice(base, () => 0.99).newState;
    subs.onGame(row(newer, 3)); // applies immediately (queue idle)
    expect(store.getState().state).toEqual(newer);

    subs.onGame(row(base, 2)); // late/out-of-order — must not rewind
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.getState().state).toEqual(newer);
  });
});

describe("optimistic roll", () => {
  it("starts the tumble on the tap and doesn't restart it when the value lands", async () => {
    const base = freshGame();
    await joinActiveGame(base, 1);

    const d = deferred<api.TurnResult>();
    vi.mocked(api.rollAction).mockReturnValue(d.promise);

    const rollSeq0 = store.getState().rollSeq;
    const done = store.getState().roll();
    // Tumble starts on the tap, before any network round trip — with no value
    // to land on yet (the die holds airborne until the server answers).
    expect(store.getState().rollSeq).toBe(rollSeq0 + 1);
    expect(store.getState().lastRoll).toBeNull();
    expect(store.getState().state?.diceValue).toBeNull();

    const rolled = rollDice(base, () => 0.99).newState;
    d.resolve({ state: rolled, v: 2 });
    await done;
    // The arriving value lands the held tumble — no second rollSeq bump.
    expect(store.getState().rollSeq).toBe(rollSeq0 + 1);
    expect(store.getState().state?.diceValue).toBe(rolled.diceValue);
    store.getState().leave(); // clear the auto-move timer before real timers resume
  });

  it("ignores a second tap while the roll is in flight", async () => {
    const base = freshGame();
    await joinActiveGame(base, 1);

    const d = deferred<api.TurnResult>();
    vi.mocked(api.rollAction).mockReturnValue(d.promise);

    const rollSeq0 = store.getState().rollSeq;
    const done = store.getState().roll();
    void store.getState().roll(); // double tap
    expect(store.getState().rollSeq).toBe(rollSeq0 + 1);
    await flush(); // the send chain fires on a microtask
    expect(api.rollAction).toHaveBeenCalledTimes(1);

    d.resolve({ state: rollDice(base, () => 0.99).newState, v: 2 });
    await done;
    store.getState().leave();
  });
});

describe("send serialization", () => {
  it("holds a follow-up action until the previous request settles", async () => {
    const rolled = rolledSix();
    await joinActiveGame(rolled, 1);
    const tokenId = store.getState().validMoves[0]!.tokenId;
    const predicted = applyMove(rolled, { tokenId }); // 6 → extra turn, awaiting-roll

    const dMove = deferred<api.TurnResult>();
    vi.mocked(api.moveAction).mockReturnValue(dMove.promise);
    const dRoll = deferred<api.TurnResult>();
    vi.mocked(api.rollAction).mockReturnValue(dRoll.promise);

    const moveDone = store.getState().selectToken(tokenId);
    expect(store.getState().state?.phase).toBe("awaiting-roll");

    const rollDone = store.getState().roll(); // fired on the extra turn
    await flush();
    // The roll animates at once but its request waits behind the move's.
    expect(api.rollAction).not.toHaveBeenCalled();

    dMove.resolve({ state: structuredClone(predicted), v: 2 });
    await moveDone;
    await flush();
    expect(api.rollAction).toHaveBeenCalledTimes(1);

    dRoll.resolve({ state: rollDice(predicted, () => 0.5).newState, v: 3 });
    await rollDone;
    store.getState().leave();
  });
});

describe("resync coalescing", () => {
  it("collapses an error burst into a single refetch", async () => {
    vi.useFakeTimers();
    const rolled = rolledSix();
    await joinActiveGame(rolled, 1);
    const moves = getValidMoves(rolled, "p1");

    vi.mocked(api.fetchGame).mockClear();
    vi.mocked(api.moveAction).mockRejectedValue(new Error("network down"));
    vi.mocked(api.rollAction).mockRejectedValue(new Error("network down"));

    // Failed move (optimistic state grants an extra turn), then a failed roll:
    // two errors back to back → one resync fetch.
    await store.getState().selectToken(moves[0]!.tokenId);
    await store.getState().roll();
    expect(store.getState().error).toContain("network down");
    expect(api.fetchGame).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(600);
    expect(api.fetchGame).toHaveBeenCalledTimes(1);
    // The refetched authoritative state replaced the failed prediction.
    expect(store.getState().state).toEqual(rolled);
  });
});

describe("prediction determinism", () => {
  it("engine transitions are byte-for-byte reproducible", () => {
    const rolled = rolledSix();
    const tokenId = getValidMoves(rolled, "p1")[0]!.tokenId;
    const a = applyMove(rolled, { tokenId });
    const b = applyMove(rolled, { tokenId });
    expect(a).toEqual(b);
    // stringify-identical: the reconciliation confirm check depends on it.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
