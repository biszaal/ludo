/**
 * Bot seating against a game that has just been deleted.
 *
 * Production, 2026-11-16 11:33 and 17:53 UTC: a player cancelled quick match at
 * the moment their bot-fill timer fired. cancel_quick_match deleted the room,
 * claim_bot_identity then failed its in_use_game_id foreign key (409), and the
 * old code read that failure as "pool empty" — so it MINTED a brand-new auth
 * user, whose bot_identities row failed the same foreign key, whose profile
 * insert hit a taken name, and whose game_bots row failed again. Once per empty
 * chair. Nine bot users were stranded that way with no pool row, never reusable.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { seatBots } from "./bots.ts";
import type { SupabaseClient } from "./lib.ts";

const GAME = "77777777-7777-7777-7777-777777777777";
const POOLED = "88888888-8888-8888-8888-888888888888";
const MINTED = "99999999-9999-9999-9999-999999999999";
const COLORS = ["red", "green", "yellow", "blue"];
const FK = { code: "23503", message: "insert or update violates foreign key constraint" };

interface Opts {
  gameExists?: boolean;
  claim?: { data: unknown; error: unknown };
  identityInsertError?: unknown;
  gameBotsError?: unknown;
  /** Every display name reads as already held by someone. */
  namesTaken?: boolean;
}

interface Log {
  rpcs: string[];
  created: number;
  deletedUsers: string[];
  inserts: Array<{ table: string; row: Record<string, unknown> }>;
  nameLookups: number;
}

function fakeAdmin(opts: Opts = {}): { admin: SupabaseClient; log: Log } {
  const log: Log = { rpcs: [], created: 0, deletedUsers: [], inserts: [], nameLookups: 0 };
  // deno-lint-ignore no-explicit-any
  const chain = (settle: () => unknown): any => {
    // deno-lint-ignore no-explicit-any
    const n: any = {
      select: () => n,
      eq: () => n,
      ilike: () => n,
      neq: () => n,
      limit: () => n,
      maybeSingle: () => Promise.resolve(settle()),
      // deno-lint-ignore no-explicit-any
      then: (res: any, rej: any) => Promise.resolve(settle()).then(res, rej),
    };
    return n;
  };
  // deno-lint-ignore no-explicit-any
  const admin: any = {
    rpc: (name: string) => {
      log.rpcs.push(name);
      return Promise.resolve(opts.claim ?? { data: POOLED, error: null });
    },
    auth: {
      admin: {
        createUser: () => {
          log.created++;
          return Promise.resolve({ data: { user: { id: MINTED } }, error: null });
        },
        deleteUser: (id: string) => {
          log.deletedUsers.push(id);
          return Promise.resolve({ data: null, error: null });
        },
      },
    },
    from: (table: string) => ({
      select: () => {
        if (table === "games") {
          return chain(() => ({ data: opts.gameExists === false ? null : { id: GAME }, error: null }));
        }
        if (table === "profiles") {
          log.nameLookups++;
          return chain(() => ({ data: opts.namesTaken ? [{ user_id: "someone" }] : [], error: null }));
        }
        return chain(() => ({ data: [], error: null }));
      },
      insert: (row: Record<string, unknown>) => {
        log.inserts.push({ table, row });
        let error: unknown = null;
        if (table === "bot_identities") error = opts.identityInsertError ?? null;
        if (table === "game_bots") error = opts.gameBotsError ?? null;
        const result = { data: null, error };
        // deno-lint-ignore no-explicit-any
        const p: any = Promise.resolve(result);
        return p;
      },
      update: () => chain(() => ({ data: null, error: null })),
      delete: () => chain(() => ({ data: null, error: null })),
    }),
  };
  return { admin: admin as SupabaseClient, log };
}

const tables = (log: Log) => log.inserts.map((i) => i.table);

Deno.test("a game that is already gone seats nothing and claims nothing", async () => {
  const { admin, log } = fakeAdmin({ gameExists: false });
  assertEquals(await seatBots(admin, GAME, [1, 2, 3], COLORS, false), 0);
  assertEquals(log.rpcs, []);
  assertEquals(log.created, 0);
  assertEquals(log.inserts, []);
});

Deno.test("a FAILED claim is not an empty pool: no user is minted, and the loop stops", async () => {
  // The production burst: the room vanished between the pre-check and the claim.
  const { admin, log } = fakeAdmin({ claim: { data: null, error: FK } });
  assertEquals(await seatBots(admin, GAME, [1, 2, 3], COLORS, false), 0);
  assertEquals(log.rpcs, ["claim_bot_identity"]); // once — not once per chair
  assertEquals(log.created, 0);
  assertEquals(log.inserts, []);
});

Deno.test("a minted user whose pool row cannot be written is deleted, not stranded", async () => {
  const { admin, log } = fakeAdmin({ claim: { data: null, error: null }, identityInsertError: FK });
  assertEquals(await seatBots(admin, GAME, [1, 2, 3], COLORS, false), 0);
  assertEquals(log.created, 1); // and only one: the loop stops on the first failure
  assertEquals(log.deletedUsers, [MINTED]);
  assertEquals(tables(log), ["bot_identities"]); // no profile, no registration, no seat
});

Deno.test("a registration refused by the game's foreign key stops the loop", async () => {
  const { admin, log } = fakeAdmin({ gameBotsError: FK });
  assertEquals(await seatBots(admin, GAME, [1, 2, 3], COLORS, false), 0);
  assertEquals(log.rpcs, ["claim_bot_identity"]);
  assertEquals(tables(log), ["game_bots"]);
});

Deno.test("an ordinary registration failure still moves on to the next chair", async () => {
  // Not every refusal means the game is gone; only the foreign key does.
  const { admin, log } = fakeAdmin({ gameBotsError: { code: "XX000", message: "insert failed" } });
  assertEquals(await seatBots(admin, GAME, [1, 2], COLORS, false), 0);
  assertEquals(log.rpcs, ["claim_bot_identity", "claim_bot_identity"]);
});

Deno.test("a minted bot checks a name is free before writing it", async () => {
  // Every pick reads as taken, so none of the five named attempts is written —
  // the only profile insert is the guest-handle fallback, and no 409 is sent.
  const { admin, log } = fakeAdmin({ claim: { data: null, error: null }, namesTaken: true });
  assertEquals(await seatBots(admin, GAME, [1], COLORS, false), 1);
  assertEquals(log.nameLookups, 5);
  const profiles = log.inserts.filter((i) => i.table === "profiles");
  assertEquals(profiles.length, 1);
  assertEquals(/^guest\d{6}$/.test(String(profiles[0]!.row.display_name)), true);
});

Deno.test("the happy path is unchanged: claim, register, seat", async () => {
  const { admin, log } = fakeAdmin();
  assertEquals(await seatBots(admin, GAME, [1, 3], COLORS, false), 2);
  assertEquals(log.created, 0);
  assertEquals(tables(log), ["game_bots", "players", "game_bots", "players"]);
});
