/**
 * Rematch by consent.
 *
 * A rematch used to be the host's switch. It is now a proposal: whoever taps
 * first opens it, everyone still seated answers, and the accepters — two or
 * more — get dealt a fresh board. The votes travel as players rows (migration
 * 0043), so what the client has to get right is reading a proposal out of those
 * rows, and behaving sanely at the two moments nothing is written at all: when
 * the window lapses, and when the room restarts without this seat.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { createGame, leaveGame, type GameState } from "@ludo/engine";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { REMATCH_SECONDS, isOverdue, readProposal } from "../src/lib/rematch";

vi.mock("../src/net/api", () => ({
  createGame: vi.fn(),
  joinGame: vi.fn(),
  startGame: vi.fn(),
  newActionId: vi.fn(() => "act-1"),
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
const P3 = { id: "p3", userId: "u3", color: "green" as const };

const NOW = 1_700_000_000_000;
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function seat(
  userId: string,
  vote: "yes" | "no" | null = null,
  votedAt: string | null = null,
): api.LobbyPlayer {
  return {
    id: `row-${userId}`,
    user_id: userId,
    color: "red",
    seat: 0,
    is_host: false,
    is_connected: true,
    is_bot: false,
    rematch_vote: vote,
    rematch_voted_at: votedAt,
  };
}

// --- Reading a proposal off the rows -----------------------------------------

describe("readProposal", () => {
  it("reports no proposal when nobody has voted", () => {
    expect(readProposal([seat("u1"), seat("u2")], NOW)).toBeNull();
  });

  it("credits the earliest vote as the proposer and dates the window from it", () => {
    const proposal = readProposal(
      [seat("u1", "yes", at(4000)), seat("u2", "yes", at(1000)), seat("u3")],
      NOW + 5000,
    );
    expect(proposal).not.toBeNull();
    expect(proposal!.byUserId).toBe("u2");
    expect(proposal!.endsAt).toBe(NOW + 1000 + REMATCH_SECONDS * 1000);
    expect(proposal!.votes).toEqual({ u1: "yes", u2: "yes" });
  });

  it("carries declines too — a 'no' is an answer, not an absence", () => {
    const proposal = readProposal([seat("u1", "yes", at(0)), seat("u2", "no", at(2000))], NOW + 3000)!;
    expect(proposal.votes).toEqual({ u1: "yes", u2: "no" });
  });

  it("stops reporting a proposal once its window has run out", () => {
    const rows = [seat("u1", "yes", at(0)), seat("u2")];
    expect(readProposal(rows, NOW + REMATCH_SECONDS * 1000 - 1)).not.toBeNull();
    expect(readProposal(rows, NOW + REMATCH_SECONDS * 1000)).toBeNull();
  });
});

describe("isOverdue", () => {
  it("is false with no votes at all — there is nothing to settle", () => {
    expect(isOverdue([seat("u1"), seat("u2")], NOW)).toBe(false);
  });

  it("is false while the window is still running", () => {
    expect(isOverdue([seat("u1", "yes", at(0))], NOW + 1000)).toBe(false);
  });

  it("is true for votes left standing past the window", () => {
    // Nothing is written when a clock expires, so these rows are exactly what a
    // lapsed proposal looks like: still there, and nobody's business but the
    // first client to notice.
    expect(isOverdue([seat("u1", "yes", at(0))], NOW + REMATCH_SECONDS * 1000 + 1)).toBe(true);
  });
});

// --- The store's half ---------------------------------------------------------

let subs: api.GameSubscription;

/**
 * A game that is over, with a winner.
 *
 * The winner is not decoration: the client decides a game is finished through
 * the engine's checkWin, which needs someone to have won — a state merely
 * stamped `status: "finished"` still projects as active, and the results screen
 * (and therefore the whole rematch path) never appears.
 */
function asFinished(game: GameState, winnerId: string): GameState {
  return { ...game, status: "finished", winnerPlayerId: winnerId, finishedOrder: [winnerId] };
}

function finished(players = [P1, P2, P3]): GameState {
  return asFinished(createGame(players, { gameId: "g1" }), players[0]!.id);
}

function row(state: GameState, v: number): api.GameRow {
  return {
    id: "g1",
    room_code: "ABCD",
    host_user_id: "u1",
    status: state.status === "finished" ? "finished" : "active",
    state,
    current_turn_player_id: state.currentTurnPlayerId,
    state_version: v,
  };
}

/**
 * Join g1 as u1/p1 and play it out to `state`.
 *
 * Joining lands in the room mid-game and the finish arrives over realtime —
 * which is how a results screen is actually reached, and matters here because
 * the store only treats a state as final once it has applied one.
 */
async function joinFinished(state = finished(), v = 5): Promise<void> {
  vi.mocked(api.joinGame).mockResolvedValue({
    gameId: "g1",
    roomCode: "ABCD",
    userId: "u1",
    myPlayerId: "p1",
  });
  const live = createGame(state.players.map((p) => ({ id: p.id, userId: p.userId, color: p.color })), {
    gameId: "g1",
  });
  vi.mocked(api.fetchGame).mockResolvedValue(row(live, v - 1));
  vi.mocked(api.subscribeGame).mockImplementation((_gameId, handlers) => {
    subs = handlers;
    return {} as RealtimeChannel;
  });
  await store.getState().join("ABCD");
  subs.onGame(row(state, v));
  await vi.advanceTimersByTimeAsync(1500); // the row queue paces on animation
  expect(store.getState().status).toBe("finished");
}

/** Push a lobby snapshot through the realtime path and let it settle. */
async function pushLobby(rows: api.LobbyPlayer[]): Promise<void> {
  vi.mocked(api.getLobby).mockResolvedValue(rows);
  // An event we can't read falls back to the debounced refetch — which is the
  // path this helper wants: it hands over a whole snapshot, not one seat.
  subs.onLobby({ type: "unknown" });
  await vi.advanceTimersByTimeAsync(200); // past LOBBY_DEBOUNCE_MS
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.mocked(api.getLobby).mockResolvedValue([]);
});

afterEach(() => {
  store.getState().leave();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("voting", () => {
  it("opens a proposal with a yes, and shows it once the rows come back", async () => {
    await joinFinished();
    const state = finished();
    vi.mocked(api.rematchVote).mockResolvedValue({ state, v: 5 });
    vi.mocked(api.getLobby).mockResolvedValue([seat("u1", "yes", at(0)), seat("u2"), seat("u3")]);

    await store.getState().proposeRematch();
    expect(api.rematchVote).toHaveBeenCalledWith("g1", "yes");

    // The vote's own response carries no new state — the proposal reaches this
    // device the same way it reaches everyone else's, through the lobby.
    await vi.advanceTimersByTimeAsync(200);
    expect(store.getState().rematchProposal?.byUserId).toBe("u1");
    expect(store.getState().rematchProposal?.votes).toEqual({ u1: "yes" });
  });

  it("sends a decline as a no", async () => {
    await joinFinished();
    vi.mocked(api.rematchVote).mockResolvedValue({ state: finished(), v: 5 });
    await store.getState().answerRematch(false);
    expect(api.rematchVote).toHaveBeenCalledWith("g1", "no");
  });

  it("asks the server to settle a proposal whose clock ran out", async () => {
    await joinFinished();
    vi.mocked(api.rematchClose).mockResolvedValue({ state: finished(), v: 5 });
    await pushLobby([seat("u1", "yes", at(0)), seat("u2"), seat("u3")]);
    expect(api.rematchClose).not.toHaveBeenCalled();

    // The window plus the client's grace and its jitter ceiling.
    await vi.advanceTimersByTimeAsync(REMATCH_SECONDS * 1000 + 4000);
    expect(api.rematchClose).toHaveBeenCalledWith("g1");
  });

  it("settles a proposal that was already stale when the rows arrived", async () => {
    // A backgrounded client comes back to votes whose deadline is long gone.
    // Nobody wrote anything when it passed, so this device has to ask.
    await joinFinished();
    vi.mocked(api.rematchClose).mockResolvedValue({ state: finished(), v: 5 });
    vi.setSystemTime(NOW + REMATCH_SECONDS * 1000 + 5000);
    await pushLobby([seat("u1", "yes", at(0)), seat("u2"), seat("u3")]);
    expect(api.rematchClose).toHaveBeenCalledWith("g1");
    expect(store.getState().rematchProposal).toBeNull();
  });

  it("says so when a proposal resolves into nothing", async () => {
    await joinFinished();
    await pushLobby([seat("u1", "yes", at(0)), seat("u2"), seat("u3")]);
    expect(store.getState().rematchProposal).not.toBeNull();

    // The server clears the votes and writes no new state. Cleared votes with
    // the game still finished is the ONLY evidence the proposal failed.
    await pushLobby([seat("u1"), seat("u2"), seat("u3")]);
    expect(store.getState().rematchProposal).toBeNull();
    expect(store.getState().rematchNotice).toMatch(/rematch/i);
  });

  it("clears that notice the moment a new proposal is made", async () => {
    await joinFinished();
    await pushLobby([seat("u1", "yes", at(0))]);
    await pushLobby([seat("u1")]);
    expect(store.getState().rematchNotice).not.toBeNull();

    vi.mocked(api.rematchVote).mockResolvedValue({ state: finished(), v: 5 });
    await store.getState().proposeRematch();
    expect(store.getState().rematchNotice).toBeNull();
  });

  it("ignores votes cast on a game that is still being played", async () => {
    await joinFinished();
    // The room rematched: a live board is the one place a vote makes no sense,
    // and a results screen left on a stale device must not be able to send one.
    subs.onGame({ ...row(createGame([P1, P2, P3], { gameId: "g1" }), 6), status: "active" });
    await vi.advanceTimersByTimeAsync(1500);
    expect(store.getState().status).toBe("active");

    await store.getState().proposeRematch();
    expect(api.rematchVote).not.toHaveBeenCalled();
  });
});

describe("a rematch that starts without this seat", () => {
  it("holds the results screen instead of dropping onto a board with no chair", async () => {
    await joinFinished();
    const result = store.getState().state!;

    // u1 declined; u2 and u3 accepted and were dealt in on the same game id.
    const without = createGame([P2, P3], { gameId: "g1" });
    subs.onGame({ ...row(without, 6), status: "active" });
    await vi.advanceTimersByTimeAsync(500);

    expect(store.getState().state).toEqual(result);
    expect(store.getState().status).toBe("finished");
    expect(store.getState().rematchNotice).toMatch(/without you/i);
  });

  it("still follows a rematch it IS part of", async () => {
    await joinFinished();
    const again = createGame([P1, P2], { gameId: "g1" });
    subs.onGame({ ...row(again, 6), status: "active" });
    await vi.advanceTimersByTimeAsync(500);

    expect(store.getState().state).toEqual(again);
    expect(store.getState().status).toBe("active");
  });

  it("does not mistake a seat that merely left the last game for a lost chair", async () => {
    // hasLeft keeps the player in the state, so the guard must not fire on it.
    const walked = leaveGame(createGame([P1, P2, P3], { gameId: "g1" }), "p1", { now: NOW });
    await joinFinished(asFinished(walked, "p2"), 5);
    expect(store.getState().rematchNotice).toBeNull();
  });
});
