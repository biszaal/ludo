/**
 * Deno tests for what happens to a seat nobody is behind.
 *
 * The bug these pin: a player closing the app used to cost the room a FULL turn
 * clock, every round, until three of them had elapsed — the other players sat
 * watching a 30-second countdown for somebody who was never coming back, over
 * and over. "The bot takes over" was true only in the sense that the turn was
 * eventually played.
 *
 * Two rules fix it, and both are only visible in what gets written:
 *
 *   - a seat already known to be away gets AWAY_TURN_SECONDS, not TURN_SECONDS,
 *     so no device in the room waits out the long clock for it;
 *   - `force` lets the server play that seat straight away rather than waiting
 *     for even the short one — the clock is a backstop, not the mechanism.
 *
 * And the counterweight, equally important: a player who is merely thinking
 * keeps every second of their own clock, and one who comes back keeps their
 * seat. Those are the cases that make an over-eager takeover a worse bug than
 * the one it fixes, so they are pinned here too.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
// @deno-types="../_shared/engine/index.d.ts"
import { createGame, getValidMoves, rollDice, type GameState } from "../_shared/engine/index.js";
import { opTurn, advanceStalledGame } from "./turn.ts";
import { AWAY_TURN_SECONDS, TURN_SECONDS, type SupabaseClient } from "./lib.ts";

const GAME = "11111111-2222-3333-4444-555555555550";
const ME = "aaaaaaaa-0000-0000-0000-000000000001";
const THEM = "bbbbbbbb-0000-0000-0000-000000000002";

/** A game where it is my turn, I have rolled, and I have nothing to move —
 *  so `pass` hands the turn to the other seat with no dice luck involved. */
function passableGame(): GameState {
  const fresh = createGame(
    [
      { id: "p1", userId: ME, color: "red" },
      { id: "p2", userId: THEM, color: "yellow" },
    ],
    { gameId: GAME },
  );
  // Anything but a six leaves four tokens in the yard and no legal move.
  const rolled = rollDice(fresh, () => 0.4).newState;
  assertEquals(rolled.diceValue! < 6, true);
  assertEquals(getValidMoves(rolled, "p1").length, 0);
  // On the LAST of the three yard rolls, so the pass genuinely hands the turn
  // over. Without this, threeRollsFromYard gives p1 another roll and the seat
  // never changes — which is the rule working, and no longer a fixture for
  // testing what a hand-off writes.
  return { ...rolled, yardRolls: 2 };
}

interface Fake {
  admin: SupabaseClient;
  row: { state: GameState; state_version: number; turn_deadline: string | null };
  /** Patches written to `games`, newest last. */
  patches: Array<Record<string, unknown>>;
  /** Patches written to `players`. */
  presence: Array<Record<string, unknown>>;
  /** Rows written to `moves`. */
  moves: Array<Record<string, unknown>>;
  /** How many times the away seat's strike counter was read. */
  awayLookups: number;
}

/**
 * Stand-in for the admin client covering the chains these ops walk.
 *
 * `missedTurns` is what the players table says about each seat, by user id: 0
 * (the default) for a player who is present, anything above it for one the
 * server has already seen idle through a whole clock. Per seat rather than per
 * game because the ops read one row and write another in the same call — an
 * acting player clearing their own strikes must not clear anyone else's.
 */
function fake(state: GameState, missedTurns: Record<string, number>, deadline: string | null = null): Fake {
  const self: Fake = {
    admin: null as unknown as SupabaseClient,
    row: { state, state_version: 0, turn_deadline: deadline },
    patches: [],
    presence: [],
    moves: [],
    awayLookups: 0,
  };
  const missed = new Map(Object.entries(missedTurns));

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
      in: () => node,
      is: () => node,
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
          state: self.row.state,
          state_version: self.row.state_version,
          turn_deadline: self.row.turn_deadline,
          is_quick: false,
          has_bots: false,
        },
        error: null,
      })),
    update: (patch: Record<string, unknown>) =>
      chain({}, (filters) => {
        // Both guards the real writes use: the version, and (stall path only)
        // the very deadline the caller read.
        if (filters["state_version"] !== self.row.state_version) return { data: null, error: null };
        if ("turn_deadline" in filters && filters["turn_deadline"] !== self.row.turn_deadline) {
          return { data: null, error: null };
        }
        self.patches.push(patch);
        self.row = {
          state: patch.state as GameState,
          state_version: patch.state_version as number,
          turn_deadline: (patch.turn_deadline as string | null) ?? null,
        };
        return { data: { id: GAME }, error: null };
      }),
  };

  const players = {
    select: () =>
      chain({}, (filters) => {
        self.awayLookups += 1;
        return { data: { missed_turns: missed.get(String(filters["user_id"])) ?? 0 }, error: null };
      }),
    update: (patch: Record<string, unknown>) =>
      chain({}, (filters) => {
        self.presence.push({ ...patch, user_id: filters["user_id"] });
        if (typeof patch.missed_turns === "number") missed.set(String(filters["user_id"]), patch.missed_turns);
        return { data: null, error: null };
      }),
  };

  const moves = {
    insert: (r: Record<string, unknown>) => {
      self.moves.push(r);
      return Promise.resolve({ data: null, error: null });
    },
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

/** Seconds from now to a written deadline, rounded — the clock the room sees. */
function clockOf(patch: Record<string, unknown>): number {
  return Math.round((Date.parse(String(patch.turn_deadline)) - Date.now()) / 1000);
}

const inAMinute = () => new Date(Date.now() + 60_000).toISOString();

// --- the clock a handoff writes -------------------------------------------------

Deno.test({
  name: "handing the turn to an away seat writes the short clock, then plays it",
  // The takeover keeps playing the seat's turn on its own timers past the
  // assertions below; the leak checkers would call that an unfinished test.
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const f = fake(passableGame(), { [THEM]: 2 });
    await opTurn(f.admin, ME, GAME, "pass");

    // What the room is told to wait: seconds, not half a minute.
    assertEquals(f.patches.length, 1);
    assertEquals(clockOf(f.patches[0]!), AWAY_TURN_SECONDS);

    // And what it actually waits, which is the part players complained about:
    // nobody has to call the timeout op, and no clock has to expire — the
    // server plays the empty seat a beat after the turn reaches it.
    await new Promise((r) => setTimeout(r, 1800));
    assertEquals(f.patches.length >= 2, true);
    assertEquals(String((f.moves.at(-1)!.action as Record<string, unknown>).action).startsWith("bot-"), true);
  },
});

Deno.test("handing the turn to a present player writes the full clock", async () => {
  // The counterweight to the test above: thinking is not being away, and the
  // whole point of a turn timer is that it belongs to the player.
  const f = fake(passableGame(), {});
  await opTurn(f.admin, ME, GAME, "pass");

  assertEquals(f.patches.length, 1);
  assertEquals(clockOf(f.patches[0]!), TURN_SECONDS);
});

Deno.test("keeping the turn costs no lookup at all", async () => {
  // A roll leaves the turn with the player who rolled. They are present by
  // definition — asking the database about them would be a round trip on the
  // hottest path in the app, for an answer already known.
  const fresh = createGame(
    [
      { id: "p1", userId: ME, color: "red" },
      { id: "p2", userId: THEM, color: "yellow" },
    ],
    { gameId: GAME },
  );
  const f = fake(fresh, { [THEM]: 3 });
  await opTurn(f.admin, ME, GAME, "roll");

  assertEquals(f.awayLookups, 0);
  assertEquals(clockOf(f.patches[0]!), TURN_SECONDS);
});

// --- playing the seat -----------------------------------------------------------

Deno.test("a live clock is not something any caller may cut short", async () => {
  const f = fake(passableGame(), {}, inAMinute());
  const outcome = await advanceStalledGame(f.admin, {
    id: GAME,
    state: f.row.state,
    turn_deadline: f.row.turn_deadline,
    state_version: 0,
    is_quick: false,
    has_bots: false,
  });

  assertEquals(outcome.kind, "not-due");
  assertEquals(f.patches.length, 0);
});

Deno.test({
  name: "force plays an away seat without waiting out its clock",
  // The deferred tail keeps playing the seat's extra turns on its own timers.
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const f = fake(passableGame(), { [ME]: 1 }, inAMinute());
    const outcome = await advanceStalledGame(
      f.admin,
      {
        id: GAME,
        state: f.row.state,
        turn_deadline: f.row.turn_deadline,
        state_version: 0,
        is_quick: false,
        has_bots: false,
      },
      { force: true },
    );

    // The seat was played even though its deadline is a minute out, because it
    // had already idled through one and nobody has come back to it.
    assertEquals(outcome.kind, "advanced");
    assertEquals(f.patches.length >= 1, true);
    assertEquals(String(f.moves[0]!.action ? (f.moves[0]!.action as Record<string, unknown>).action : "").startsWith("bot-"), true);
    // And the absence is now on the record: another strike, and the Away badge.
    assertEquals(f.presence[0]!.is_connected, false);
    assertEquals(f.presence[0]!.missed_turns, 2);
  },
});

Deno.test({
  name: "an app that never comes back is removed from the game",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    // One short of the limit: this turn is the strike that ends it.
    const f = fake(passableGame(), { [ME]: 4 }, inAMinute());
    const outcome = await advanceStalledGame(
      f.admin,
      {
        id: GAME,
        state: f.row.state,
        turn_deadline: f.row.turn_deadline,
        state_version: 0,
        is_quick: false,
        has_bots: false,
      },
      { force: true },
    );

    assertEquals(outcome.kind, "advanced");
    assertEquals(f.moves.map((m) => (m.action as Record<string, unknown>).action), ["auto-leave"]);
    // Removed for good, not merely skipped again — the seat stops being dealt
    // turns at all, which is what ends the game for the player who stayed.
    const me = f.row.state.players.find((p) => p.userId === ME);
    assertEquals(me!.hasLeft, true);
  },
});
