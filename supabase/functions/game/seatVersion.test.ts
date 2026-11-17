/**
 * A seat remembers which build sat in it.
 *
 * There is no OTA channel (no expo-updates), so every client in the wild is a
 * store binary the server cannot patch. Phase 2 wants to fold the roll write
 * into the move write — one realtime push per turn instead of two — but an old
 * client renders the opponent's die FROM that separate push, so folding it away
 * takes the die from anyone who has not updated. The fold therefore has to be
 * decided per game: only when every human seat can understand it.
 *
 * That decision needs the version pinned at SEAT time, not the version of
 * whatever request happens to arrive later — otherwise a player updating
 * mid-match would flip the broadcast shape underneath the table. Hence a column
 * on `players` rather than one row per user.
 *
 * Nothing reads this yet. It ships alone, ahead of the feature, because it is
 * only useful once it is already in the store.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "./lib.ts";
import { opCreate, opJoin } from "./room.ts";
import { opQuickMatch } from "./quick.ts";

const USER = "11111111-1111-1111-1111-111111111111";
const GAME = "22222222-2222-2222-2222-222222222222";

interface Fake {
  admin: SupabaseClient;
  /** Rows inserted into `players`, newest last. */
  seats: Array<Record<string, unknown>>;
}

/** Stand-in for the admin client covering the chains the seating ops walk. */
function fake(existingSeats: Array<Record<string, unknown>> = []): Fake {
  const self: Fake = { admin: null as unknown as SupabaseClient, seats: [] };

  // deno-lint-ignore no-explicit-any
  const chain = (settle: () => { data?: unknown; error?: unknown }): any => {
    // deno-lint-ignore no-explicit-any
    const node: any = {
      eq: () => node,
      order: () => Promise.resolve(settle()),
      select: () => node,
      limit: () => node,
      maybeSingle: () => Promise.resolve(settle()),
      single: () => Promise.resolve(settle()),
      // deno-lint-ignore no-explicit-any
      then: (res: any, rej: any) => Promise.resolve(settle()).then(res, rej),
    };
    return node;
  };

  const games = {
    insert: () => chain(() => ({ data: { id: GAME, room_code: "ABCD" }, error: null })),
    select: () =>
      chain(() => ({ data: { id: GAME, status: "waiting", stake: 0 }, error: null })),
  };

  const players = {
    insert: (row: Record<string, unknown>) => {
      self.seats.push(row);
      return chain(() => ({ data: { id: "player-1" }, error: null }));
    },
    select: () => chain(() => ({ data: existingSeats, error: null })),
  };

  const app_config = {
    select: () => chain(() => ({ data: { value: { stakes: [0] } }, error: null })),
  };

  self.admin = {
    from: (table: string) => {
      if (table === "games") return games;
      if (table === "players") return players;
      if (table === "app_config") return app_config;
      return chain(() => ({ data: null, error: null }));
    },
    // deno-lint-ignore no-explicit-any
    rpc: () => Promise.resolve({ data: null, error: null }) as any,
    // deno-lint-ignore no-explicit-any
  } as any;

  return self;
}

Deno.test("the host's seat records the build that opened the room", async () => {
  const f = fake();

  await opCreate(f.admin, USER, 0, "1.1.0");

  assertEquals(f.seats.length, 1);
  assertEquals(f.seats[0]!.app_version, "1.1.0");
});

Deno.test("a joiner's seat records the build that joined", async () => {
  const f = fake([]);

  await opJoin(f.admin, USER, "ABCD", "1.2.3");

  assertEquals(f.seats.length, 1);
  assertEquals(f.seats[0]!.app_version, "1.2.3");
});

Deno.test("a client too old to send a version seats as null, not as a guess", async () => {
  // Every 1.0.1 binary in the wild sends no appVersion at all. Recording a
  // default like "1.0.0" would be inventing a fact; null is the honest answer
  // and is what the Phase 2 gate must read as "cannot fold".
  const f = fake();

  await opCreate(f.admin, USER, 0, null);

  assertEquals(f.seats[0]!.app_version, null);
});

/** Seat version and funding commit together; no second stamp request exists. */
function quickFake(seated: number, size: number) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const order: string[] = [];
  const admin = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "rate_limit_hit") return Promise.resolve({ data: true, error: null });
      order.push("entry");
      return Promise.resolve({ data: { gameId: GAME, playerId: "seat", seated, size, waiting: true, stake: 100, mode: "classic" }, error: null });
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => {
      order.push("deal");
      return Promise.resolve({ data: { status: "active", state: { gameId: GAME }, state_version: 2 } });
    } }) }) }),
  } as unknown as SupabaseClient;
  return { admin, calls, order };
}
Deno.test("quick entry commits the app version and request key with its funded seat", async () => {
  const f=quickFake(1,4);
  await opQuickMatch(f.admin,USER,4,null,"1.4.0","classic","request-one");
  const call=f.calls.find(c=>c.name==="quick_match_enter")!;
  assertEquals(call.args.p_app_version,"1.4.0");
  assertEquals(call.args.p_request,"request-one");
  assertEquals(f.order,["entry"]);
});
Deno.test("a full room starts only after the atomic entry has returned", async () => {
  const f=quickFake(2,2);
  await opQuickMatch(f.admin,USER,2,null,"1.4.0","classic","request-one");
  assertEquals(f.order,["entry","deal"]);
});
Deno.test("a missing request key reaches money only through the funded transaction", async () => {
  // Installed apps up to 1.2.3 send no key, and refusing them would switch quick
  // match off for every player who has not updated (0080). What must still hold
  // is that the ONLY money-changing call they reach is quick_match_enter, whose
  // already-seated resume stops their retries charging twice.
  const f=quickFake(1,4);
  const result=await (await opQuickMatch(f.admin,USER,4,null,"1.0.0")).json();
  assertEquals(result.error,undefined);
  assertEquals(f.order,["entry"]);
  assertEquals(f.calls.filter(c=>c.name!=="rate_limit_hit").map(c=>c.name),["quick_match_enter"]);
  assertEquals(f.calls.find(c=>c.name==="quick_match_enter")!.args.p_request,null);
});
