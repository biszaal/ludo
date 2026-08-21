/**
 * Deno tests for idempotent turn actions.
 *
 * A dropped request is the common failure on a congested mobile link, and until
 * these guarantees existed the client could not retry one: replaying a lost
 * roll would have rolled twice. The contract the retry leans on is narrow and
 * exact, so it is pinned here rather than inferred from the call site.
 *
 *   a `moves` row with this client_action_id exists  <=>  the action applied
 *
 * Both directions matter. If a replay could apply again, a retry double-acts a
 * turn. If a claim could outlive a write that never landed, the retry is wedged
 * against an action id that will never be honoured — and the player's roll is
 * cancelled just as surely as before, only now silently.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
// @deno-types="../_shared/engine/index.d.ts"
import { createGame, type GameState } from "../_shared/engine/index.js";
import { opTurn } from "./turn.ts";
import type { SupabaseClient } from "./lib.ts";

const GAME = "11111111-2222-3333-4444-555555555555";
const ME = "aaaaaaaa-0000-0000-0000-000000000001";
const THEM = "bbbbbbbb-0000-0000-0000-000000000002";

/** p1's turn, awaiting-roll — the seat every test below acts from. */
function freshGame(): GameState {
  return createGame(
    [
      { id: "p1", userId: ME, color: "red" },
      { id: "p2", userId: THEM, color: "yellow" },
    ],
    { gameId: GAME },
  );
}

interface Fake {
  admin: SupabaseClient;
  /** Flip to let a previously-losing version guard start winning. */
  casWins: boolean;
  /** Rows the op wrote to `moves`, claim releases already removed. */
  moves: Array<Record<string, unknown>>;
  /** Current games row, as the op's own writes left it. */
  row: { state: GameState; state_version: number; has_bots: boolean };
  /** How many times the games row was actually updated. */
  writes: number;
}

/**
 * Stand-in for the admin client covering exactly the chains opTurn walks.
 *
 * `casWins` forces the version-guarded write to miss the way a racing stall bot
 * makes it miss, and `writeFails` makes it error outright — the two ways a
 * claimed action can end up never applied.
 */
function fake(state: GameState, v = 0, opts: { casWins?: boolean; writeFails?: boolean } = {}): Fake {
  const self: Fake = {
    admin: null as unknown as SupabaseClient,
    casWins: opts.casWins ?? true,
    moves: [],
    row: { state, state_version: v, has_bots: false },
    writes: 0,
  };

  /** A chain node that is both filterable and awaitable, like PostgREST's. */
  const chain = (
    filters: Record<string, unknown>,
    settle: (filters: Record<string, unknown>) => { data?: unknown; error?: unknown },
    // deno-lint-ignore no-explicit-any
  ): any => {
    // deno-lint-ignore no-explicit-any
    const node: any = {
      eq: (col: string, val: unknown) => chain({ ...filters, [col]: val }, settle),
      or: () => node,
      gt: () => node,
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
        data: { id: GAME, state: self.row.state, state_version: self.row.state_version, has_bots: false },
        error: null,
      })),
    update: (patch: Record<string, unknown>) =>
      chain({}, (filters) => {
        if (opts.writeFails) return { data: null, error: { message: "write failed" } };
        if (!self.casWins || filters["state_version"] !== self.row.state_version) return { data: null, error: null };
        self.row = {
          state: patch.state as GameState,
          state_version: patch.state_version as number,
          has_bots: false,
        };
        self.writes += 1;
        return { data: { id: GAME }, error: null };
      }),
  };

  const moves = {
    select: () =>
      chain({}, (filters) => ({
        data: self.moves.find((m) => m.client_action_id === filters["client_action_id"]) ? { id: "m1" } : null,
        error: null,
      })),
    insert: (r: Record<string, unknown>) => {
      const id = r.client_action_id as string | null | undefined;
      // The partial unique index on (game_id, client_action_id).
      if (id != null && self.moves.some((m) => m.client_action_id === id)) {
        return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
      }
      self.moves.push(r);
      return Promise.resolve({ data: null, error: null });
    },
    delete: () =>
      chain({}, (filters) => {
        self.moves = self.moves.filter((m) => m.client_action_id !== filters["client_action_id"]);
        return { data: null, error: null };
      }),
  };

  // isAwaySeat reads it before the write; the presence reset writes it after.
  const players = {
    select: () => chain({}, () => ({ data: { missed_turns: 0 }, error: null })),
    update: () => chain({}, () => ({ data: null, error: null })),
  };

  self.admin = {
    from: (table: string) => {
      if (table === "games") return games;
      if (table === "moves") return moves;
      return players;
    },
  } as unknown as SupabaseClient;
  return self;
}

interface TurnBody {
  state?: GameState;
  v?: number;
  duplicate?: boolean;
  error?: string;
}

const body = async (res: Response) => (await res.json()) as TurnBody;

const ACTION = "act-0001";

// --- the happy path still behaves ---------------------------------------------

Deno.test("a first roll applies and records its action id", async () => {
  const f = fake(freshGame());
  const res = await body(await opTurn(f.admin, ME, GAME, "roll", undefined, ACTION));

  assertEquals(res.error, undefined);
  assertEquals(res.v, 1);
  assertEquals(f.writes, 1);
  assertEquals(f.moves.length, 1);
  assertEquals(f.moves[0]!.client_action_id, ACTION);
  assertEquals(typeof res.state!.diceValue, "number");
});

// --- replay: the guarantee the retry is built on --------------------------------

Deno.test("replaying an action id does not act twice", async () => {
  const f = fake(freshGame());
  const first = await body(await opTurn(f.admin, ME, GAME, "roll", undefined, ACTION));
  const replay = await body(await opTurn(f.admin, ME, GAME, "roll", undefined, ACTION));

  // One write, one logged move — the retry changed nothing.
  assertEquals(f.writes, 1);
  assertEquals(f.moves.length, 1);
  assertEquals(replay.error, undefined);
  assertEquals(replay.duplicate, true);
  // And the die the player is waiting on is the one already rolled, not a new
  // number: a second roll here would be the server cheating its own player.
  assertEquals(replay.state!.diceValue, first.state!.diceValue);
  assertEquals(replay.v, first.v);
});

Deno.test("a replay is honoured even after the turn has moved on", async () => {
  // The worst version of the lost-response case: the roll landed, the player
  // busted or passed, and by the time their retry arrives the seat belongs to
  // somebody else. The ordinary answer would be "Not your turn" — an error
  // thrown at a player whose action actually succeeded.
  const f = fake(freshGame());
  await opTurn(f.admin, ME, GAME, "roll", undefined, ACTION);
  f.row = { ...f.row, state: { ...f.row.state, currentTurnPlayerId: "p2" }, state_version: 9 };

  const replay = await body(await opTurn(f.admin, ME, GAME, "roll", undefined, ACTION));
  assertEquals(replay.error, undefined);
  assertEquals(replay.duplicate, true);
  assertEquals(f.writes, 1);
});

Deno.test("a different action id on the same seat is a real second action", async () => {
  const f = fake(freshGame());
  await opTurn(f.admin, ME, GAME, "roll", undefined, ACTION);
  const second = await body(await opTurn(f.admin, ME, GAME, "roll", undefined, "act-0002"));

  // Rolling twice in a row is illegal on its own merits — the phase check, not
  // the action id, is what refuses it. The point is that it was not swallowed
  // as a duplicate.
  assertEquals(second.duplicate, undefined);
  assertEquals(second.error, "You already rolled.");
});

// --- the claim must never outlive a write that did not land ---------------------

Deno.test("a raced write releases its claim so the retry can still act", async () => {
  const f = fake(freshGame(), 0, { casWins: false });
  const lost = await body(await opTurn(f.admin, ME, GAME, "roll", undefined, ACTION));

  assertEquals(f.writes, 0);
  assertEquals(f.moves.length, 0, "a claim for an action that never applied must be released");
  assertEquals(lost.duplicate, undefined);

  // The race is over and the seat is still ours. The SAME id must now be able
  // to act: a claim left behind would answer this "already done" forever, and
  // the roll the player is waiting on would never happen.
  f.casWins = true;
  const retry = await body(await opTurn(f.admin, ME, GAME, "roll", undefined, ACTION));
  assertEquals(retry.error, undefined);
  assertEquals(retry.duplicate, undefined);
  assertEquals(f.writes, 1);
  assertEquals(typeof retry.state!.diceValue, "number");
});

Deno.test("a failed write releases its claim", async () => {
  const f = fake(freshGame(), 0, { writeFails: true });
  const res = await body(await opTurn(f.admin, ME, GAME, "roll", undefined, ACTION));

  assertEquals(f.writes, 0);
  assertEquals(f.moves.length, 0);
  assertEquals(typeof res.error, "string");

  // A transient write failure is exactly what a retry is for; the id has to
  // still be good once the database is answering again.
  const healthy = fake(freshGame());
  healthy.moves = f.moves;
  const retry = await body(await opTurn(healthy.admin, ME, GAME, "roll", undefined, ACTION));
  assertEquals(retry.error, undefined);
  assertEquals(retry.duplicate, undefined);
  assertEquals(healthy.writes, 1);
});

// --- older clients ---------------------------------------------------------------

Deno.test("an action with no id behaves exactly as before", async () => {
  const f = fake(freshGame());
  const first = await body(await opTurn(f.admin, ME, GAME, "roll"));
  assertEquals(first.error, undefined);
  assertEquals(first.duplicate, undefined);
  assertEquals(f.writes, 1);
});
