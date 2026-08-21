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

/**
 * A state as Postgres hands it back, rather than as the engine built it.
 *
 * `games.state` is jsonb, which does not store key order — it sorts keys by
 * length, then bytewise. So the realtime row and the resync fetch carry a
 * DIFFERENT key order from the HTTP response of the very same write, and
 * reconciliation compares states with JSON.stringify.
 */
function jsonbOrder<T>(v: T): T {
  if (Array.isArray(v)) return v.map(jsonbOrder) as unknown as T;
  if (v && typeof v === "object") {
    const keys = Object.keys(v as object).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = jsonbOrder((v as Record<string, unknown>)[k]);
    return out as T;
  }
  return v;
}

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

  it("a roll is reproducible from its die alone", () => {
    // What the prefetched roll rests on. The server rolls with rngForDie and
    // the client predicts with the same expression here; if a roll carried any
    // other input — a clock, an id, an iteration order — the two states would
    // differ and every prediction would be 'contradicted' and re-tumbled.
    const fresh = freshGame();
    for (let die = 1; die <= 6; die++) {
      const a = rollDice(fresh, () => (die - 0.5) / 6);
      const b = rollDice(fresh, () => (die - 0.5) / 6);
      expect(a.diceValue).toBe(die);
      expect(JSON.stringify(a.newState)).toBe(JSON.stringify(b.newState));
    }
  });

  it("must not be given a clock", () => {
    // The server calls rollDice with no options, which stamps the action
    // timestamp 0. A client that helpfully passed `now` would produce a state
    // that is right in every way except one, and stringify would reject it.
    const fresh = freshGame();
    const server = rollDice(fresh, () => (4 - 0.5) / 6).newState;
    const withClock = rollDice(fresh, () => (4 - 0.5) / 6, { now: 1_700_000_000_000 }).newState;
    expect(JSON.stringify(withClock)).not.toBe(JSON.stringify(server));
  });

  it("the edge function runs the very same engine build", () => {
    // The prediction is a byte compare against a state built by the copy of the
    // engine vendored into supabase/functions. That was already true for moves
    // and passes; rolls now lean on it too. A drift here does not throw — it
    // silently turns every prediction into a mismatch, which the player sees as
    // the die re-rolling itself after it has landed.
    const dist = resolve(__dirname, "../../../packages/engine/dist");
    const edge = resolve(__dirname, "../../../supabase/functions/_shared/engine");
    const js = readdirSync(dist).filter((f) => f.endsWith(".js")).sort();
    expect(js.length).toBeGreaterThan(0);
    for (const file of js) {
      expect(readFileSync(join(edge, file), "utf8")).toBe(readFileSync(join(dist, file), "utf8"));
    }
  });
});

/**
 * The prefetched die.
 *
 * A roll's number is the server's to make, which used to mean the die had
 * nothing to land on until the round trip came back — on a slow link, a die
 * that tumbles and tumbles. The server now hands the number over BEFORE the tap
 * (api.prepareRoll, or piggybacked as nextRoll on the action that earned the
 * roll), so the roll joins moves and passes as something the client can predict
 * and animate at once.
 *
 * What these pin down is the part that is easy to get subtly wrong: a prepared
 * die is good for exactly one roll at exactly one version, and a prediction the
 * server contradicts has to be taken back ON A ROLL, never by repainting a
 * number onto a die that has already stopped.
 */
describe("prefetched dice", () => {
  /** Let primeRoll's prefetch settle so the cache is populated. */
  const primed = async (dice: number, v: number) => {
    vi.mocked(api.prepareRoll).mockResolvedValue({ v, dice });
    await flush();
  };

  it("lands the die on the prepared number without waiting for the server", async () => {
    const fresh = freshGame();
    vi.mocked(api.prepareRoll).mockResolvedValue({ v: 1, dice: 6 });
    await joinActiveGame(fresh, 1);
    await flush(); // the prefetch fired as the turn arrived

    const predicted = rollDice(fresh, () => (6 - 0.5) / 6).newState;
    const seqBefore = store.getState().rollSeq;

    const d = deferred<api.TurnResult>();
    vi.mocked(api.rollAction).mockReturnValue(d.promise);
    const done = store.getState().roll();

    // The number is on the die and the board has moved on, with the request
    // still in flight. This is the whole point of the change.
    expect(store.getState().lastRoll).toBe(6);
    expect(store.getState().rollSeq).toBe(seqBefore + 1);
    expect(store.getState().state).toEqual(predicted);

    d.resolve({ state: structuredClone(predicted), v: 2 });
    await done;
    expect(store.getState().lastRoll).toBe(6);
    // Confirmed, so no second tumble: the die the player watched land is the die.
    expect(store.getState().rollSeq).toBe(seqBefore + 1);
    expect(store.getState().error).toBeNull();
  });

  it("tumbles with no number when nothing was prepared", async () => {
    const fresh = freshGame();
    vi.mocked(api.prepareRoll).mockResolvedValue(null); // old server, or no secret
    await joinActiveGame(fresh, 1);
    await flush();

    const d = deferred<api.TurnResult>();
    vi.mocked(api.rollAction).mockReturnValue(d.promise);
    const seqBefore = store.getState().rollSeq;
    const done = store.getState().roll();

    // The slow path, unchanged: the die spins on a null value rather than
    // settling on a face the server has not confirmed.
    expect(store.getState().rollSeq).toBe(seqBefore + 1);
    expect(store.getState().lastRoll).toBeNull();
    expect(store.getState().state).toEqual(fresh);

    const rolled = rollDice(fresh, () => 0.99).newState;
    d.resolve({ state: rolled, v: 2 });
    await done;
    expect(store.getState().lastRoll).toBe(6);
  });

  it("refuses a die prepared for a version the board has moved past", async () => {
    const fresh = freshGame();
    vi.mocked(api.prepareRoll).mockResolvedValue({ v: 1, dice: 6 });
    await joinActiveGame(fresh, 1);
    await flush(); // the die for v=1 is now in hand

    // An opponent's write lands, so that die belongs to a board that is no
    // longer on screen — the server will roll at the new version and get a
    // different number. Using it would show a face the roll never produced.
    vi.mocked(api.prepareRoll).mockResolvedValue(null);
    subs.onGame(row(structuredClone(fresh), 5));
    await flush();

    const d = deferred<api.TurnResult>();
    vi.mocked(api.rollAction).mockReturnValue(d.promise);
    const done = store.getState().roll();

    expect(store.getState().lastRoll).toBeNull(); // slow path, tumbling
    expect(store.getState().state).toEqual(fresh); // and nothing predicted

    d.resolve({ state: rollDice(fresh, () => 0.99).newState, v: 6 });
    await done;
  });

  it("drops a prefetch that arrives after the board has moved on", async () => {
    // The other half of the same problem, at the other end. The prefetch is a
    // round trip of its own, so its answer can land after a write has already
    // moved the board — installing it then would leave a stale die sitting in
    // the cache looking perfectly current.
    const fresh = freshGame();
    const late = deferred<{ v: number; dice: number } | null>();
    vi.mocked(api.prepareRoll).mockReturnValue(late.promise);
    await joinActiveGame(fresh, 1);

    subs.onGame(row(structuredClone(fresh), 5)); // board moves first
    await flush();
    late.resolve({ v: 1, dice: 6 }); // …then the answer for v=1 turns up
    await flush();

    const d = deferred<api.TurnResult>();
    vi.mocked(api.rollAction).mockReturnValue(d.promise);
    const done = store.getState().roll();

    expect(store.getState().lastRoll).toBeNull();
    expect(store.getState().state).toEqual(fresh);

    d.resolve({ state: rollDice(fresh, () => 0.99).newState, v: 6 });
    await done;
  });

  it("spends a prepared die on one roll and no more", async () => {
    // A prepared die is good for exactly one roll at exactly one version. The
    // front-line guards here are the ones a second tap actually meets — the
    // request still in flight, and a phase that is no longer awaiting a roll —
    // and what they have to produce is no second prediction.
    const fresh = freshGame();
    vi.mocked(api.prepareRoll).mockResolvedValue({ v: 1, dice: 6 });
    await joinActiveGame(fresh, 1);
    await flush();

    const six = rollDice(fresh, () => (6 - 0.5) / 6).newState;
    const d = deferred<api.TurnResult>();
    vi.mocked(api.rollAction).mockReturnValue(d.promise);
    void store.getState().roll();
    expect(store.getState().state).toEqual(six);

    // Tap again, twice: mid-flight, and again once the roll is confirmed.
    await store.getState().roll();
    expect(store.getState().state).toEqual(six);
    expect(api.rollAction).toHaveBeenCalledTimes(1);

    d.resolve({ state: structuredClone(six), v: 2 });
    await flush();
    await store.getState().roll();
    expect(store.getState().state).toEqual(six); // the six is owed a move, not a roll
    expect(api.rollAction).toHaveBeenCalledTimes(1);
  });

  it("takes the next roll's die from the response that earned it", async () => {
    // A chained roll is the one roll with no gap in front of it to prefetch
    // during, so its die rides back on the response instead. Rolling a six
    // leaves you owing a MOVE, and it is that move's response that hands over
    // the die for the roll waiting behind it.
    const fresh = freshGame();
    vi.mocked(api.prepareRoll).mockResolvedValue({ v: 1, dice: 6 });
    await joinActiveGame(fresh, 1);
    await flush();

    const six = rollDice(fresh, () => (6 - 0.5) / 6).newState;
    vi.mocked(api.rollAction).mockResolvedValue({ state: structuredClone(six), v: 2 });
    await store.getState().roll();

    const tokenId = store.getState().validMoves[0]!.tokenId;
    const moved = applyMove(six, { tokenId });
    expect(moved.phase).toBe("awaiting-roll");
    expect(moved.currentTurnPlayerId).toBe("p1"); // the six bought another roll
    vi.mocked(api.moveAction).mockResolvedValue({
      state: structuredClone(moved),
      v: 3,
      nextRoll: { v: 3, dice: 3 },
    });
    await store.getState().selectToken(tokenId);

    // No prefetch is needed or wanted for this one — the die is already here.
    vi.mocked(api.prepareRoll).mockResolvedValue(null);
    const chained = rollDice(moved, () => (3 - 0.5) / 6).newState;
    const d = deferred<api.TurnResult>();
    vi.mocked(api.rollAction).mockReturnValue(d.promise);
    void store.getState().roll();

    // Instant, on the number the move's response carried.
    expect(store.getState().lastRoll).toBe(3);
    expect(store.getState().state).toEqual(chained);

    d.resolve({ state: structuredClone(chained), v: 4 });
    await flush();
  });

  it("takes back a contradicted prediction with a roll, not a repaint", async () => {
    // The die must never be seen changing its mind. If the server disagrees
    // with a predicted roll, the real number has to arrive the way every number
    // does — on a tumble — so rollSeq has to bump a second time.
    const fresh = freshGame();
    vi.mocked(api.prepareRoll).mockResolvedValue({ v: 1, dice: 6 });
    await joinActiveGame(fresh, 1);
    await flush();

    const d = deferred<api.TurnResult>();
    vi.mocked(api.rollAction).mockReturnValue(d.promise);
    const done = store.getState().roll();
    const seqAfterTap = store.getState().rollSeq;
    expect(store.getState().lastRoll).toBe(6);

    // The server rolled something else entirely (our die was stale, a stall bot
    // got there first — the reason doesn't matter, the repaint does).
    const actual = rollDice(fresh, () => (2 - 0.5) / 6).newState;
    d.resolve({ state: structuredClone(actual), v: 2 });
    await done;

    expect(store.getState().lastRoll).toBe(2);
    expect(store.getState().rollSeq).toBe(seqAfterTap + 1);
  });

  it("takes back a contradicted prediction that arrives over realtime too", async () => {
    const fresh = freshGame();
    vi.mocked(api.prepareRoll).mockResolvedValue({ v: 1, dice: 6 });
    await joinActiveGame(fresh, 1);
    await flush();

    const d = deferred<api.TurnResult>();
    vi.mocked(api.rollAction).mockReturnValue(d.promise);
    void store.getState().roll();
    const seqAfterTap = store.getState().rollSeq;

    const actual = rollDice(fresh, () => (2 - 0.5) / 6).newState;
    subs.onGame(row(structuredClone(actual), 2));
    await flush();

    expect(store.getState().lastRoll).toBe(2);
    expect(store.getState().rollSeq).toBe(seqAfterTap + 1);

    d.resolve({ state: structuredClone(actual), v: 2 });
    await flush();
  });

  it("holds a predicted bust on the six before handing over", async () => {
    // The awkward one: a third six moves no token and passes the turn, so the
    // board must sit on the six long enough to be read before the hand-off.
    // The optimistic path reaches that hold ~a round trip earlier than the old
    // one did, which makes getting it right more visible, not less.
    vi.useFakeTimers();
    let state = freshGame();
    // Two sixes, each moved — a six owes a move before it earns the next roll.
    for (let i = 0; i < 2; i++) {
      state = rollDice(state, () => (6 - 0.5) / 6).newState;
      state = applyMove(state, { tokenId: getValidMoves(state, "p1")[0]!.tokenId });
    }
    expect(state.consecutiveSixes).toBe(2);
    expect(state.phase).toBe("awaiting-roll");
    expect(state.currentTurnPlayerId).toBe("p1");

    vi.mocked(api.prepareRoll).mockResolvedValue({ v: 1, dice: 6 });
    await joinActiveGame(state, 1);
    await vi.advanceTimersByTimeAsync(0);

    const busted = rollDice(state, () => (6 - 0.5) / 6).newState;
    expect(busted.currentTurnPlayerId).toBe("p2"); // the third six forfeits

    const seqBefore = store.getState().rollSeq;
    vi.mocked(api.rollAction).mockResolvedValue({ state: structuredClone(busted), v: 2 });
    const done = store.getState().roll();

    // Held: the six is on the die, the turn has NOT visibly moved, and the tap's
    // tumble is the only one — no second bump from our own confirmation.
    expect(store.getState().bustHold).toBe(true);
    expect(store.getState().lastRoll).toBe(6);
    expect(store.getState().state!.currentTurnPlayerId).toBe("p1");
    expect(store.getState().rollSeq).toBe(seqBefore + 1);

    await done;
    await vi.advanceTimersByTimeAsync(BUST_HOLD_MS + 10);
    expect(store.getState().bustHold).toBe(false);
    expect(store.getState().state!.currentTurnPlayerId).toBe("p2");
    expect(store.getState().rollSeq).toBe(seqBefore + 1);
  });

  it("still tumbles the die for the NEXT player to roll", async () => {
    // Regression: rollBumped is a one-shot "the tap already started this
    // tumble, don't start another" flag, and it is spent by the next rolled
    // state that gets APPLIED. A fast-path roll applies its own state with
    // rolled=false, so the flag is not spent there — and if it is left set, the
    // very next rolled state to arrive is an OPPONENT's, whose tumble it
    // silently swallows. Their number appears on a die that never rolled.
    vi.useFakeTimers();
    const fresh = freshGame();
    vi.mocked(api.prepareRoll).mockResolvedValue({ v: 1, dice: 3 });
    await joinActiveGame(fresh, 1);
    await vi.advanceTimersByTimeAsync(0);

    const mine = rollDice(fresh, () => (3 - 0.5) / 6).newState;
    vi.mocked(api.rollAction).mockResolvedValue({ state: structuredClone(mine), v: 2 });
    await store.getState().roll();
    await vi.advanceTimersByTimeAsync(0);

    // The turn reaches the next player…
    const theirTurn = {
      ...structuredClone(mine),
      currentTurnPlayerId: "p2",
      phase: "awaiting-roll",
      diceValue: null,
    } as GameState;
    subs.onGame(row(theirTurn, 3));
    await vi.advanceTimersByTimeAsync(2000); // let the row queue drain

    const seqBefore = store.getState().rollSeq;
    // …and they roll.
    const theirRoll = { ...structuredClone(theirTurn), phase: "awaiting-move", diceValue: 5 } as GameState;
    subs.onGame(row(theirRoll, 4));
    await vi.advanceTimersByTimeAsync(2000);

    expect(store.getState().lastRoll).toBe(5);
    expect(store.getState().rollSeq).toBe(seqBefore + 1); // their die tumbled
  });

  it("does not re-tumble when the realtime echo comes back jsonb-reordered", async () => {
    // Realtime rows and resync fetches come out of a jsonb column, and jsonb
    // does not preserve key order — it sorts by length then bytewise. The HTTP
    // response does not go through that, so the same state reaches the client
    // in two different key orders, and reconciliation compares them with
    // JSON.stringify. An echo that loses that compare is treated as the server
    // DISAGREEING, which re-tumbles a die that was perfectly correct.
    vi.useFakeTimers();
    const fresh = freshGame();
    vi.mocked(api.prepareRoll).mockResolvedValue({ v: 1, dice: 6 });
    await joinActiveGame(fresh, 1);
    await vi.advanceTimersByTimeAsync(0);

    const mine = rollDice(fresh, () => (6 - 0.5) / 6).newState;
    const d = deferred<api.TurnResult>();
    vi.mocked(api.rollAction).mockReturnValue(d.promise);
    void store.getState().roll();
    const seqAfterTap = store.getState().rollSeq;

    // The echo of our own write, as the database actually returns it.
    subs.onGame(row(jsonbOrder(mine), 2));
    await vi.advanceTimersByTimeAsync(2000);

    expect(store.getState().lastRoll).toBe(6);
    expect(store.getState().rollSeq).toBe(seqAfterTap); // one tumble, not two

    d.resolve({ state: structuredClone(mine), v: 2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().rollSeq).toBe(seqAfterTap);
  });

  it("does not re-tumble after an optimistic move echoes back reordered", async () => {
    // The same race one step later: a six keeps the turn, so the move's echo
    // lands while the die still shows the six.
    vi.useFakeTimers();
    const fresh = freshGame();
    vi.mocked(api.prepareRoll).mockResolvedValue({ v: 1, dice: 6 });
    await joinActiveGame(fresh, 1);
    await vi.advanceTimersByTimeAsync(0);

    const mine = rollDice(fresh, () => (6 - 0.5) / 6).newState;
    vi.mocked(api.rollAction).mockResolvedValue({ state: structuredClone(mine), v: 2 });
    await store.getState().roll();
    await vi.advanceTimersByTimeAsync(0);

    const tokenId = store.getState().validMoves[0]!.tokenId;
    const moved = applyMove(mine, { tokenId });
    const md = deferred<api.TurnResult>();
    vi.mocked(api.moveAction).mockReturnValue(md.promise);
    void store.getState().selectToken(tokenId);
    const seqBefore = store.getState().rollSeq;

    subs.onGame(row(jsonbOrder(moved), 3));
    await vi.advanceTimersByTimeAsync(2000);

    expect(store.getState().rollSeq).toBe(seqBefore); // the six must not roll again

    md.resolve({ state: structuredClone(moved), v: 3 });
    await vi.advanceTimersByTimeAsync(0);
  });

  it("adopts a prefetch that lands while the roll is already in flight", async () => {
    // The opening roll: tapped before its prefetch answered, so it went the
    // slow way. The prefetch was sent first though, so it usually answers
    // first — and its number is the one the roll will return. Taking it now
    // lets the die land on the lap it is running instead of a second one.
    const fresh = freshGame();
    const late = deferred<{ v: number; dice: number } | null>();
    vi.mocked(api.prepareRoll).mockReturnValue(late.promise);
    await joinActiveGame(fresh, 1);

    const rd = deferred<api.TurnResult>();
    vi.mocked(api.rollAction).mockReturnValue(rd.promise);
    const seqBefore = store.getState().rollSeq;
    const done = store.getState().roll();

    // Slow path: tumbling with no number yet.
    expect(store.getState().rollSeq).toBe(seqBefore + 1);
    expect(store.getState().lastRoll).toBeNull();

    // The prefetch answers while the roll is still on the wire.
    const mine = rollDice(fresh, () => (4 - 0.5) / 6).newState;
    late.resolve({ v: 1, dice: 4 });
    await flush();

    // The die has its number, the board has moved, and there is no second tumble.
    expect(store.getState().lastRoll).toBe(4);
    expect(store.getState().state).toEqual(mine);
    expect(store.getState().rollSeq).toBe(seqBefore + 1);

    // The roll already in flight is now just the confirmation.
    rd.resolve({ state: structuredClone(mine), v: 2 });
    await done;
    expect(store.getState().rollSeq).toBe(seqBefore + 1);
    expect(store.getState().error).toBeNull();
  });

  it("ignores a late prefetch once the die already has its number", async () => {
    // If the roll answered first there is nothing to adopt, and adopting would
    // mean predicting over a state that is already authoritative.
    const fresh = freshGame();
    const late = deferred<{ v: number; dice: number } | null>();
    vi.mocked(api.prepareRoll).mockReturnValue(late.promise);
    await joinActiveGame(fresh, 1);

    const mine = rollDice(fresh, () => 0.99).newState;
    vi.mocked(api.rollAction).mockResolvedValue({ state: structuredClone(mine), v: 2 });
    await store.getState().roll();
    const seqAfter = store.getState().rollSeq;
    expect(store.getState().lastRoll).toBe(6);

    late.resolve({ v: 1, dice: 2 }); // stale by now
    await flush();

    expect(store.getState().lastRoll).toBe(6);
    expect(store.getState().rollSeq).toBe(seqAfter);
  });

  it("never prefetches on an opponent's turn", async () => {
    const fresh = freshGame();
    const theirs = { ...fresh, currentTurnPlayerId: "p2" };
    vi.mocked(api.prepareRoll).mockResolvedValue({ v: 1, dice: 6 });
    await joinActiveGame(theirs as GameState, 1);
    await flush();
    expect(api.prepareRoll).not.toHaveBeenCalled();
  });
});
