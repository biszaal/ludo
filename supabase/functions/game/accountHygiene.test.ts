/**
 * Deno tests for two writes that production logs showed failing every day:
 *
 *   * the grandfather grant in opEntitlementsGet (economy.ts) — a plain INSERT
 *     of the worn avatar that hit entitlements_pkey on every shop load by
 *     anyone who already owned it (409 in the logs);
 *   * opDeleteAccount (social.ts) — deleting the auth user left that user's
 *     seats behind, because players.user_id and games.host_user_id carry no
 *     foreign key to auth.users. A waiting room hosted by a deleted account
 *     sat open until the 24h reap; an active seat sat until the turn clock
 *     idled it out.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { opEntitlementsGet } from "./economy.ts";
import { opDeleteAccount } from "./social.ts";
import type { SupabaseClient } from "./lib.ts";

const ME = "aaaaaaaa-0000-0000-0000-000000000001";

// deno-lint-ignore no-explicit-any
type Any = any;

/** A chainable query node that resolves to `result`, recording its filters. */
function node(result: () => unknown, filters: Array<[string, unknown]> = []): Any {
  const n: Any = {
    select: () => n,
    eq: (c: string, v: unknown) => (filters.push([`eq:${c}`, v]), n),
    in: (c: string, v: unknown) => (filters.push([`in:${c}`, v]), n),
    maybeSingle: () => Promise.resolve(result()),
    single: () => Promise.resolve(result()),
    then: (res: Any, rej: Any) => Promise.resolve(result()).then(res, rej),
  };
  return n;
}

// --- grandfather grant --------------------------------------------------------

Deno.test("the worn-avatar grant is an upsert that ignores an existing row", async () => {
  const writes: Array<{ kind: string; rows: unknown; opts?: Record<string, unknown> }> = [];
  const admin = {
    rpc: () => Promise.resolve({ data: true, error: null }),
    from: (table: string) => {
      if (table === "profiles") return node(() => ({ data: { avatar_id: "ruby" }, error: null }));
      if (table === "entitlements") {
        return {
          ...node(() => ({ data: [{ sku: "avatar.ruby" }], error: null })),
          insert: (rows: unknown) => {
            writes.push({ kind: "insert", rows });
            // What production answers: the player already owns it.
            return node(() => ({ data: null, error: { code: "23505", message: "entitlements_pkey" } }));
          },
          upsert: (rows: unknown, opts: Record<string, unknown>) => {
            writes.push({ kind: "upsert", rows, opts });
            return node(() => ({ data: null, error: null }));
          },
        };
      }
      return node(() => ({ data: [], error: null }));
    },
  } as unknown as SupabaseClient;

  const res = await (await opEntitlementsGet(admin, ME)).json();

  assertEquals(res.skus, ["avatar.ruby"]);
  assertEquals(writes.length, 1);
  assertEquals(writes[0].kind, "upsert");
  assertEquals(writes[0].opts?.onConflict, "user_id,sku");
  assertEquals(writes[0].opts?.ignoreDuplicates, true);
});

// --- delete account -----------------------------------------------------------

interface DelFake {
  admin: SupabaseClient;
  /** In call order: "leave:<game>", "closeHosted", "deleteUser". */
  calls: string[];
  closedFilters: Array<[string, unknown]>;
  seatFilters: Array<[string, unknown]>;
}

function deleteFake(seatedIn: string[]): DelFake {
  const self: DelFake = { admin: null as unknown as SupabaseClient, calls: [], closedFilters: [], seatFilters: [] };
  self.admin = {
    rpc: () => Promise.resolve({ data: true, error: null }),
    from: (table: string) => {
      if (table === "players") {
        return node(() => ({ data: seatedIn.map((g) => ({ game_id: g })), error: null }), self.seatFilters);
      }
      if (table === "games") {
        return {
          delete: () => {
            self.calls.push("closeHosted");
            return node(() => ({ data: null, error: null }), self.closedFilters);
          },
        };
      }
      return node(() => ({ data: null, error: null }));
    },
    auth: {
      admin: {
        deleteUser: () => {
          self.calls.push("deleteUser");
          return Promise.resolve({ data: null, error: null });
        },
      },
    },
  } as unknown as SupabaseClient;
  return self;
}

Deno.test("deleting an account gives up every live seat before the user goes", async () => {
  const f = deleteFake(["g1", "g2"]);
  const leave = (_a: SupabaseClient, user: string, game: string) => {
    assertEquals(user, ME);
    f.calls.push(`leave:${game}`);
    return Promise.resolve(new Response("{}"));
  };

  const res = await (await opDeleteAccount(f.admin, ME, leave)).json();

  assertEquals(res.ok, true);
  assertEquals(f.calls, ["leave:g1", "leave:g2", "closeHosted", "deleteUser"]);
  // Only this user's seats, and only in games still being played or waited
  // on — a finished game has nothing to give up and is reaped in a week.
  assertEquals(f.seatFilters, [
    ["eq:user_id", ME],
    ["in:games.status", ["waiting", "active"]],
  ]);
  // Only friend rooms nobody has started: a quick room is opLeave's to tear
  // down (it refunds the other seats), and a live game is never deleted.
  assertEquals(f.closedFilters, [
    ["eq:host_user_id", ME],
    ["eq:status", "waiting"],
    ["eq:is_quick", false],
  ]);
});

Deno.test("a seat that will not let go never blocks the deletion itself", async () => {
  // Account deletion is a store requirement. A failed leave is tidied by the
  // turn clock and the reaper; a failed delete is a player we cannot honour.
  const f = deleteFake(["g1"]);
  const leave = () => Promise.reject(new Error("boom"));

  const res = await (await opDeleteAccount(f.admin, ME, leave)).json();

  assertEquals(res.ok, true);
  assertEquals(f.calls.includes("deleteUser"), true);
});
