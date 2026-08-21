/**
 * Deno tests for rematch-by-consent (room.ts, migration 0043).
 *
 * The rules being pinned here are the ones a player would feel if they broke:
 *
 *   * a proposal never restarts the table on its own — two seats have to
 *     accept, and the seats that didn't are left out of the new deal;
 *   * a proposal that can no longer reach two accepters is over immediately,
 *     rather than making everyone watch a countdown with nothing behind it;
 *   * the clock is the server's. A client asking to settle a proposal early
 *     gets told no, however sure its own clock is.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
// @deno-types="../_shared/engine/index.d.ts"
import { createGame, type GameState } from "../_shared/engine/index.js";
import { opRematchClose, opRematchVote } from "./room.ts";
import type { SupabaseClient } from "./lib.ts";

const GAME = "11111111-2222-3333-4444-555555555555";
const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const C = "cccccccc-0000-0000-0000-000000000003";

/** Matches REMATCH_SECONDS in room.ts. */
const WINDOW_MS = 30_000;

function threeHanded(): GameState {
  return createGame(
    [
      { id: "p1", userId: A, color: "red" },
      { id: "p2", userId: B, color: "yellow" },
      { id: "p3", userId: C, color: "green" },
    ],
    { gameId: GAME },
  );
}

/** The finished game the results screen is showing. */
function overGame(state = threeHanded()): GameState {
  return { ...state, status: "finished", winnerPlayerId: "p1", finishedOrder: ["p1"] };
}

interface PlayerRow {
  user_id: string;
  rematch_vote: "yes" | "no" | null;
  rematch_voted_at: string | null;
}

interface Fake {
  admin: SupabaseClient;
  row: { status: string; state: GameState; state_version: number; has_bots: boolean };
  players: PlayerRow[];
  /** Users whose players row was deleted (left out of the rematch). */
  removed: string[];
  writes: number;
}

/**
 * Stand-in for the admin client, covering the chains the rematch ops walk.
 *
 * The players table is modelled with real rows rather than stubbed answers,
 * because the whole feature is "what do the rows say" — a fake that answered
 * from a script would pass while agreeing with nothing.
 */
function fake(state: GameState, opts: { votes?: PlayerRow[]; hasBots?: boolean } = {}): Fake {
  const self: Fake = {
    admin: null as unknown as SupabaseClient,
    row: { status: state.status, state, state_version: 7, has_bots: opts.hasBots ?? false },
    players: opts.votes ??
      state.players.map((p) => ({ user_id: p.userId, rematch_vote: null, rematch_voted_at: null })),
    removed: [],
    writes: 0,
  };

  // deno-lint-ignore no-explicit-any
  const chain = (filters: Record<string, unknown>, settle: (f: Record<string, unknown>) => any): any => {
    // deno-lint-ignore no-explicit-any
    const node: any = {
      eq: (col: string, val: unknown) => chain({ ...filters, [col]: val }, settle),
      is: (col: string, val: unknown) => chain({ ...filters, [`is:${col}`]: val }, settle),
      not: (col: string, op: string, val: unknown) => chain({ ...filters, [`not:${col}:${op}`]: val }, settle),
      in: (col: string, val: unknown) => chain({ ...filters, [`in:${col}`]: val }, settle),
      select: () => node,
      maybeSingle: () => Promise.resolve(settle(filters)),
      single: () => Promise.resolve(settle(filters)),
      // deno-lint-ignore no-explicit-any
      then: (res: any, rej: any) => Promise.resolve(settle(filters)).then(res, rej),
    };
    return node;
  };

  const games = {
    select: () =>
      chain({}, () => ({
        data: {
          id: GAME,
          status: self.row.status,
          state: self.row.state,
          state_version: self.row.state_version,
          has_bots: self.row.has_bots,
        },
        error: null,
      })),
    update: (patch: Record<string, unknown>) =>
      chain({}, (filters) => {
        if (filters["state_version"] !== self.row.state_version) return { data: null, error: null };
        self.row = {
          status: patch.status as string,
          state: patch.state as GameState,
          state_version: patch.state_version as number,
          has_bots: self.row.has_bots,
        };
        self.writes += 1;
        return { data: { id: GAME }, error: null };
      }),
  };

  const players = {
    select: () => chain({}, () => ({ data: self.players, error: null })),
    update: (patch: Record<string, unknown>) =>
      chain({}, (filters) => {
        const only = filters["user_id"] as string | undefined;
        const among = filters["in:user_id"] as string[] | undefined;
        const unansweredOnly = "is:rematch_vote" in filters;
        for (const row of self.players) {
          if (only && row.user_id !== only) continue;
          if (among && !among.includes(row.user_id)) continue;
          if (unansweredOnly && row.rematch_vote !== null) continue;
          if ("rematch_vote" in patch) row.rematch_vote = patch.rematch_vote as "yes" | "no" | null;
          if ("rematch_voted_at" in patch) row.rematch_voted_at = patch.rematch_voted_at as string | null;
        }
        return { data: null, error: null };
      }),
    delete: () =>
      chain({}, (filters) => {
        const keep = filters["not:user_id:in"] as string | undefined;
        if (!keep) return { data: null, error: null };
        const kept = keep.replace(/[()]/g, "").split(",");
        self.removed.push(...self.players.filter((r) => !kept.includes(r.user_id)).map((r) => r.user_id));
        self.players = self.players.filter((r) => kept.includes(r.user_id));
        return { data: null, error: null };
      }),
  };

  const moves = { insert: () => Promise.resolve({ data: null, error: null }) };
  const gameBots = { select: () => chain({}, () => ({ data: [], error: null })) };

  self.admin = {
    from: (table: string) => {
      if (table === "games") return games;
      if (table === "players") return players;
      if (table === "moves") return moves;
      return gameBots;
    },
  } as unknown as SupabaseClient;
  return self;
}

interface Body {
  state?: GameState;
  v?: number;
  error?: string;
  rematchStarted?: boolean;
}
const body = async (res: Response) => (await res.json()) as Body;

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const voteRow = (
  user: string,
  vote: "yes" | "no" | null = null,
  agoMs = 0,
): PlayerRow => ({ user_id: user, rematch_vote: vote, rematch_voted_at: vote ? ago(agoMs) : null });

// --- one tap is a proposal, not a restart ------------------------------------

Deno.test("the first yes opens a proposal and restarts nothing", async () => {
  const f = fake(overGame());
  const res = await body(await opRematchVote(f.admin, A, GAME, "yes"));

  assertEquals(res.error, undefined);
  assertEquals(f.writes, 0); // the board is untouched — this is a question
  assertEquals(f.row.status, "finished");
  assertEquals(f.players.find((p) => p.user_id === A)!.rematch_vote, "yes");
  assertEquals(f.players.find((p) => p.user_id === B)!.rematch_vote, null);
});

Deno.test("a build too old to send a vote proposes rather than restarts", async () => {
  // The router reads a missing `vote` as a yes. That build's host tap has to
  // land as a proposal, or the whole consent rule has a door left open in it.
  const f = fake(overGame());
  await opRematchVote(f.admin, A, GAME, "yes");
  assertEquals(f.writes, 0);
  assertEquals(f.row.status, "finished");
});

// --- what it takes to actually deal ------------------------------------------

Deno.test("two accepters deal a fresh board and drop everyone else", async () => {
  const f = fake(overGame(), { votes: [voteRow(A, "yes", 2000), voteRow(B), voteRow(C, "no", 1000)] });
  const res = await body(await opRematchVote(f.admin, B, GAME, "yes"));

  assertEquals(res.rematchStarted, true);
  assertEquals(f.writes, 1);
  assertEquals(f.row.status, "active");
  assertEquals(f.row.state.players.map((p) => p.userId).sort(), [A, B].sort());
  assertEquals(f.removed, [C]);
  // The accepters keep their chairs, so nobody's myPlayerId goes stale.
  assertEquals(f.row.state.players.map((p) => p.id).sort(), ["p1", "p2"]);
});

Deno.test("the pot does not ride on a rematch", async () => {
  // The previous game already paid out; re-staking seated players would be a
  // charge nobody agreed to.
  const f = fake(overGame(), { votes: [voteRow(A, "yes", 1000), voteRow(B), voteRow(C, "no", 500)] });
  await opRematchVote(f.admin, B, GAME, "yes");
  assertEquals(f.writes, 1);
});

Deno.test("one accepter is not a rematch", async () => {
  const f = fake(overGame(), { votes: [voteRow(A, "yes", 2000), voteRow(B, "no", 1000), voteRow(C)] });
  const res = await body(await opRematchVote(f.admin, C, GAME, "no"));

  assertEquals(res.rematchStarted, undefined);
  assertEquals(f.writes, 0);
  assertEquals(f.row.status, "finished");
  // Votes cleared: the results screen goes back to offering a rematch.
  assertEquals(f.players.every((p) => p.rematch_vote === null), true);
});

Deno.test("a decline does not sink a proposal others can still carry", async () => {
  // B is out, but C hasn't answered — and C accepting would still make a game
  // of it. An undecided seat is never counted as a no while the clock runs.
  const f = fake(overGame(), { votes: [voteRow(A, "yes", 3000), voteRow(B), voteRow(C)] });
  await opRematchVote(f.admin, B, GAME, "no");

  assertEquals(f.writes, 0);
  assertEquals(f.players.find((p) => p.user_id === A)!.rematch_vote, "yes");
  assertEquals(f.players.find((p) => p.user_id === B)!.rematch_vote, "no");
  assertEquals(f.players.find((p) => p.user_id === C)!.rematch_vote, null);
});

// --- the clock is the server's ------------------------------------------------

Deno.test("a close asked for early is refused", async () => {
  const f = fake(overGame(), { votes: [voteRow(A, "yes", 1000), voteRow(B), voteRow(C)] });
  const res = await body(await opRematchClose(f.admin, B, GAME));

  assertEquals(res.error, undefined);
  assertEquals(f.writes, 0);
  // Still standing — a fast client's opinion of the time changed nothing.
  assertEquals(f.players.find((p) => p.user_id === A)!.rematch_vote, "yes");
});

Deno.test("a lapsed proposal deals whoever had accepted", async () => {
  const f = fake(overGame(), {
    votes: [voteRow(A, "yes", WINDOW_MS + 5000), voteRow(B, "yes", WINDOW_MS + 4000), voteRow(C)],
  });
  const res = await body(await opRematchClose(f.admin, C, GAME));

  assertEquals(res.rematchStarted, true);
  assertEquals(f.row.status, "active");
  assertEquals(f.removed, [C]); // never answered, so not dealt in
});

Deno.test("a lapsed proposal with only one accepter just clears", async () => {
  const f = fake(overGame(), { votes: [voteRow(A, "yes", WINDOW_MS + 5000), voteRow(B), voteRow(C)] });
  await opRematchClose(f.admin, C, GAME);

  assertEquals(f.writes, 0);
  assertEquals(f.players.every((p) => p.rematch_vote === null), true);
});

Deno.test("votes from a table everyone walked away from are swept, not honoured", async () => {
  // Two people accepted ten minutes ago and nobody's clock ever fired. Dealing
  // a board now would restart a game they stopped looking at long ago.
  const stale = 10 * 60 * 1000;
  const f = fake(overGame(), { votes: [voteRow(A, "yes", stale), voteRow(B, "yes", stale), voteRow(C)] });
  await opRematchClose(f.admin, A, GAME);

  assertEquals(f.writes, 0);
  assertEquals(f.row.status, "finished");
  assertEquals(f.players.every((p) => p.rematch_vote === null), true);
});

Deno.test("a new proposal is not dated by the last one's leftovers", async () => {
  // Lapsed rows counted into a fresh proposal would date it to the OLD stamp,
  // which is already past — the new proposal would be born expired.
  const f = fake(overGame(), { votes: [voteRow(A, "yes", WINDOW_MS + 60_000), voteRow(B), voteRow(C)] });
  await opRematchVote(f.admin, B, GAME, "yes");

  const bRow = f.players.find((p) => p.user_id === B)!;
  assertEquals(bRow.rematch_vote, "yes");
  assertEquals(Date.now() - Date.parse(bRow.rematch_voted_at!) < 1000, true);
  // A's stale yes was cleared rather than counted, so this is a live 1-vote
  // proposal and not an instant two-accepter deal off a dead row.
  assertEquals(f.players.find((p) => p.user_id === A)!.rematch_vote, null);
  assertEquals(f.writes, 0);
});

// --- who may vote at all -------------------------------------------------------

Deno.test("a game still in progress takes no votes", async () => {
  const f = fake(threeHanded());
  const res = await body(await opRematchVote(f.admin, A, GAME, "yes"));
  assertEquals(res.error, "The game is still in progress.");
});

Deno.test("someone who is not at the table cannot vote", async () => {
  const f = fake(overGame());
  const res = await body(await opRematchVote(f.admin, "dddddddd-0000-0000-0000-000000000004", GAME, "yes"));
  assertEquals(res.error, "You are not in this game.");
});

Deno.test("a player who walked out of the last game has no say in the next", async () => {
  const state = overGame();
  const walked: GameState = {
    ...state,
    players: state.players.map((p) => (p.userId === C ? { ...p, hasLeft: true } : p)),
  };
  // A and B accept; C is gone, so nobody is waiting on them.
  const f = fake(walked, { votes: [voteRow(A, "yes", 2000), voteRow(B), voteRow(C)] });
  const res = await body(await opRematchVote(f.admin, B, GAME, "yes"));

  assertEquals(res.rematchStarted, true);
  assertEquals(f.row.state.players.map((p) => p.userId).sort(), [A, B].sort());
});

Deno.test("declining when no proposal is running is a quiet no-op", async () => {
  // A results screen whose proposal lapsed a moment ago still has its buttons.
  const f = fake(overGame());
  const res = await body(await opRematchVote(f.admin, A, GAME, "no"));

  assertEquals(res.error, undefined);
  assertEquals(f.players.every((p) => p.rematch_vote === null), true);
});
