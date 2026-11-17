/**
 * Online Blitz: how a mode gets from a request onto the board.
 *
 * What is being pinned:
 *
 *   * classic stays exactly as it was. Nothing new is written, the old 3-arg
 *     claim is still the one called, and the dealt state has no new key —
 *     clients confirm their predictions by comparing state JSON byte for byte;
 *   * Blitz is behind a server flag, and is refused BEFORE any coins move;
 *   * an app too old to play Blitz cannot sit down at a Blitz table, because its
 *     engine would disagree with the server about who has placed;
 *   * the pool is split: a Blitz search only ever claims Blitz rooms.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
// @deno-types="../_shared/engine/index.d.ts"
import type { GameState } from "../_shared/engine/index.js";
import type { SupabaseClient } from "./lib.ts";
import { startGameNow } from "./deal.ts";
import { modeOfState, parseMode, rulesForMode } from "./modes.ts";
import { opQuickMatch } from "./quick.ts";
import { opCreate, opJoin } from "./room.ts";

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "33333333-3333-3333-3333-333333333333";
const GAME = "22222222-2222-2222-2222-222222222222";

interface FakeOptions {
  /** `modes.blitzOnline` in the server's config row. */
  flag?: boolean;
  /** The row a join or a deal reads from `games`. */
  game?: Record<string, unknown>;
  seats?: Array<Record<string, unknown>>;
  claimed?: Record<string, unknown> | null;
}

interface Fake {
  admin: SupabaseClient;
  gameInserts: Array<Record<string, unknown>>;
  seatInserts: Array<Record<string, unknown>>;
  gameUpdates: Array<Record<string, unknown>>;
  rpcs: Array<{ name: string; args: Record<string, unknown> }>;
}

function fake(opts: FakeOptions = {}): Fake {
  const self: Fake = {
    admin: null as unknown as SupabaseClient,
    gameInserts: [],
    seatInserts: [],
    gameUpdates: [],
    rpcs: [],
  };

  // deno-lint-ignore no-explicit-any
  const chain = (settle: () => { data?: unknown; error?: unknown }): any => {
    // deno-lint-ignore no-explicit-any
    const node: any = {
      eq: () => node,
      in: () => node,
      order: () => node,
      select: () => node,
      limit: () => node,
      maybeSingle: () => Promise.resolve(settle()),
      single: () => Promise.resolve(settle()),
      // deno-lint-ignore no-explicit-any
      then: (res: any, rej: any) => Promise.resolve(settle()).then(res, rej),
    };
    return node;
  };

  const game = opts.game ?? { id: GAME, status: "waiting", stake: 0, mode: "classic" };

  self.admin = {
    from: (table: string) => {
      if (table === "app_config") {
        return {
          select: () =>
            chain(() => ({
              data: { value: { economy: { stakeTiers: [100] }, modes: { blitzOnline: opts.flag ?? false } } },
              error: null,
            })),
        };
      }
      if (table === "games") {
        return {
          insert: (row: Record<string, unknown>) => {
            self.gameInserts.push(row);
            return chain(() => ({ data: { id: GAME, room_code: "ABCD" }, error: null }));
          },
          select: () => chain(() => ({ data: game, error: null })),
          update: (patch: Record<string, unknown>) => {
            self.gameUpdates.push(patch);
            return chain(() => ({ data: { id: GAME }, error: null }));
          },
        };
      }
      if (table === "players") {
        return {
          insert: (row: Record<string, unknown>) => {
            self.seatInserts.push(row);
            return chain(() => ({ data: { id: "player-new" }, error: null }));
          },
          // The re-tap check in quick match reads a single row; the lobby reads a list.
          select: () => {
            const seats = opts.seats ?? [];
            // deno-lint-ignore no-explicit-any
            const node: any = chain(() => ({ data: seats, error: null }));
            node.maybeSingle = () => Promise.resolve({ data: null, error: null });
            node.limit = () => node;
            return node;
          },
          update: () => chain(() => ({ data: null, error: null })),
          delete: () => chain(() => ({ data: null, error: null })),
        };
      }
      return chain(() => ({ data: [], error: null }));
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      self.rpcs.push({ name, args });
      if (name === "quick_match_enter") return Promise.resolve({ data: opts.claimed ?? { gameId: GAME, playerId: "seat", seated: 1, size: args.p_size, stake: args.p_stake, mode: args.p_mode, waiting: true }, error: null });
      if (name === "wallet_apply") return Promise.resolve({ data: 500, error: null });
      if (name === "rate_limit_hit") return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    // deno-lint-ignore no-explicit-any
  } as any;

  return self;
}

// deno-lint-ignore no-explicit-any
const body = async (res: Response): Promise<any> => await res.json();
const debits = (f: Fake) => f.rpcs.filter((r) => r.name === "wallet_apply");
const claims = (f: Fake) => f.rpcs.filter((r) => r.name === "quick_match_enter");

// --- reading a mode -----------------------------------------------------------

Deno.test("a request with no mode is classic; anything unknown is refused", () => {
  assertEquals(parseMode(undefined), "classic");
  assertEquals(parseMode(null), "classic");
  assertEquals(parseMode("classic"), "classic");
  assertEquals(parseMode("blitz"), "blitz");
  assertEquals(parseMode("frenzy"), null); // vs AI only — the server cannot run it
  assertEquals(parseMode("nonsense"), null);
});

Deno.test("Blitz rules round-trip through the state; classic adds no key at all", () => {
  assertEquals(rulesForMode("classic"), {});
  assertEquals(rulesForMode("blitz"), { tokensToWin: 1 });
  assertEquals(modeOfState({ rules: {} } as unknown as GameState), "classic");
  assertEquals(modeOfState({ rules: { tokensToWin: 1 } } as unknown as GameState), "blitz");
});

// --- the flag -----------------------------------------------------------------

Deno.test("a Blitz room is refused while the flag is off, and nothing is created", async () => {
  const f = fake({ flag: false });
  const res = await body(await opCreate(f.admin, USER, 0, "1.3.0", "blitz"));

  assertEquals(typeof res.error, "string");
  assertEquals(f.gameInserts.length, 0);
});

Deno.test("a Blitz search is refused while the flag is off, before any coins move", async () => {
  const f = fake({ flag: false });
  const res = await body(await opQuickMatch(f.admin, USER, 2, 100, "1.3.0", "blitz", "request-one"));

  assertEquals(typeof res.error, "string");
  assertEquals(debits(f).length, 0);
  assertEquals(claims(f).length, 0);
});

Deno.test("an unknown mode is refused, flag or no flag", async () => {
  const f = fake({ flag: true });
  const res = await body(await opQuickMatch(f.admin, USER, 2, 100, "1.3.0", "frenzy", "request-one"));

  assertEquals(typeof res.error, "string");
  assertEquals(debits(f).length, 0);
});

// --- creating -----------------------------------------------------------------

Deno.test("a Blitz room records its mode and says so", async () => {
  const f = fake({ flag: true });
  const res = await body(await opCreate(f.admin, USER, 0, "1.3.0", "blitz"));

  assertEquals(f.gameInserts[0]!.mode, "blitz");
  assertEquals(res.mode, "blitz");
});

Deno.test("a classic room writes no mode, so the column default stays the one answer", async () => {
  const f = fake({ flag: false });
  const res = await body(await opCreate(f.admin, USER, 0, "1.2.3"));

  assertEquals("mode" in f.gameInserts[0]!, false);
  assertEquals(res.mode, "classic");
});

// --- the pool -----------------------------------------------------------------

Deno.test("a Blitz search claims only from the Blitz pool", async () => {
  const f = fake({ flag: true });
  const res = await body(await opQuickMatch(f.admin, USER, 2, 100, "1.3.0", "blitz", "request-one"));

  assertEquals(claims(f)[0]!.args, { p_user: USER, p_size: 2, p_stake: 100, p_mode: "blitz", p_app_version: "1.3.0", p_request: "request-one" });
  assertEquals(f.gameInserts.length, 0); // SQL owns room creation
  assertEquals(res.mode, "blitz");
});

Deno.test("classic searches explicitly select the classic atomic pool", async () => {
  const f = fake({ flag: true });
  await opQuickMatch(f.admin, USER, 2, 100, "1.4.0", "classic", "request-one");
  assertEquals(claims(f)[0]!.args, { p_user: USER, p_size: 2, p_stake: 100, p_mode: "classic", p_app_version: "1.4.0", p_request: "request-one" });
  assertEquals(f.gameInserts.length, 0);
});

// --- joining ------------------------------------------------------------------

const blitzRoom = { id: GAME, status: "waiting", stake: 0, mode: "blitz" };

Deno.test("an app that cannot play Blitz cannot sit down at a Blitz table", async () => {
  const f = fake({ game: blitzRoom, seats: [{ id: "p0", user_id: OTHER, seat: 0 }] });
  const res = await body(await opJoin(f.admin, USER, "ABCD", "1.2.3"));

  assertEquals(typeof res.error, "string");
  assertEquals(f.seatInserts.length, 0);
});

Deno.test("an app that says it can play Blitz sits down, and hears the mode", async () => {
  const f = fake({ game: blitzRoom, seats: [{ id: "p0", user_id: OTHER, seat: 0 }] });
  const res = await body(await opJoin(f.admin, USER, "ABCD", "1.3.0", ["blitz"]));

  assertEquals(f.seatInserts.length, 1);
  assertEquals(res.mode, "blitz");
});

Deno.test("a full or missing Blitz room gives the usual refusal, not a hint that it is Blitz", async () => {
  // The update message may only ever stand where a join would have succeeded,
  // or it turns the code sweep protection in opJoin back into an oracle.
  const fullSeats = [0, 1, 2, 3].map((seat) => ({ id: `p${seat}`, user_id: `u${seat}`, seat }));
  const full = await body(await opJoin(fake({ game: blitzRoom, seats: fullSeats }).admin, USER, "ABCD", "1.2.3"));
  const classicFull = await body(await opJoin(fake({ seats: fullSeats }).admin, USER, "ABCD", "1.2.3"));

  assertEquals(full.error, classicFull.error);
});

Deno.test("anyone can join a classic room, whatever they send", async () => {
  const f = fake({ seats: [{ id: "p0", user_id: OTHER, seat: 0 }] });
  await opJoin(f.admin, USER, "ABCD", "1.2.3");

  assertEquals(f.seatInserts.length, 1);
});

// --- dealing ------------------------------------------------------------------

function dealFake(mode: string): Fake {
  return fake({
    game: { id: GAME, status: "waiting", has_bots: false, state: null, state_version: 0, is_quick: true, stake: 0, mode },
    seats: [
      { id: "p0", user_id: USER, color: "red", seat: 0, app_version: "1.3.0" },
      { id: "p1", user_id: OTHER, color: "yellow", seat: 1, app_version: "1.3.0" },
    ],
  });
}

Deno.test("a Blitz room deals the Blitz rule", async () => {
  const f = dealFake("blitz");
  await startGameNow(f.admin, GAME);

  assertEquals((f.gameUpdates[0]!.state as GameState).rules.tokensToWin, 1);
});

Deno.test("a classic room deals a state with no new key", async () => {
  const f = dealFake("classic");
  await startGameNow(f.admin, GAME);

  assertEquals("tokensToWin" in (f.gameUpdates[0]!.state as GameState).rules, false);
});
