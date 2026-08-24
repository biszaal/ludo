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

/**
 * Quick match is the awkward one: `quick_match_claim` inserts the seat inside
 * SQL (0018), and that function's signature is deliberately versioned so an
 * already-deployed edge function keeps working across a migration. Rather than
 * add a parameter to it — and own the compatibility window that creates — the
 * caller stamps the row it was just handed.
 */
function quickFake(claimed: Record<string, unknown> | null): {
  admin: SupabaseClient;
  seats: Array<Record<string, unknown>>;
  stamps: Array<{ patch: Record<string, unknown>; id: unknown }>;
} {
  const seats: Array<Record<string, unknown>> = [];
  const stamps: Array<{ patch: Record<string, unknown>; id: unknown }> = [];

  // deno-lint-ignore no-explicit-any
  const chain = (settle: () => { data?: unknown; error?: unknown }, filters: Record<string, unknown> = {}): any => {
    // deno-lint-ignore no-explicit-any
    const node: any = {
      eq: (col: string, val: unknown) => chain(settle, { ...filters, [col]: val }),
      order: () => Promise.resolve(settle()),
      select: () => node,
      limit: () => node,
      maybeSingle: () => Promise.resolve(settle()),
      single: () => Promise.resolve(settle()),
      filters: () => filters,
      // deno-lint-ignore no-explicit-any
      then: (res: any, rej: any) => Promise.resolve(settle()).then(res, rej),
    };
    return node;
  };

  const players = {
    insert: (row: Record<string, unknown>) => {
      seats.push(row);
      return chain(() => ({ data: { id: "player-new" }, error: null }));
    },
    select: () => chain(() => ({ data: null, error: null })),
    update: (patch: Record<string, unknown>) => {
      // deno-lint-ignore no-explicit-any
      const node: any = {
        eq: (_col: string, val: unknown) => {
          stamps.push({ patch, id: val });
          return Promise.resolve({ data: null, error: null });
        },
      };
      return node;
    },
    delete: () => chain(() => ({ data: null, error: null })),
  };

  const admin = {
    from: (table: string) => {
      if (table === "players") return players;
      if (table === "games") {
        return { insert: () => chain(() => ({ data: { id: GAME, room_code: "WXYZ" }, error: null })) };
      }
      return chain(() => ({ data: null, error: null }));
    },
    rpc: (name: string) => {
      if (name === "quick_match_claim") return Promise.resolve({ data: claimed, error: null });
      if (name === "wallet_apply") return Promise.resolve({ data: 500, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    // deno-lint-ignore no-explicit-any
  } as any;

  return { admin, seats, stamps };
}

Deno.test("a quick seat claimed in SQL gets stamped with the build that claimed it", async () => {
  const f = quickFake({ game_id: GAME, player_id: "player-7", seated: 1 });

  await opQuickMatch(f.admin, USER, 4, null, "1.1.0");

  assertEquals(f.stamps.length, 1);
  assertEquals(f.stamps[0]!.patch.app_version, "1.1.0");
  assertEquals(f.stamps[0]!.id, "player-7");
});

Deno.test("opening a new quick room records the build on the seat directly", async () => {
  const f = quickFake(null);

  await opQuickMatch(f.admin, USER, 2, null, "1.1.0");

  assertEquals(f.seats.length, 1);
  assertEquals(f.seats[0]!.app_version, "1.1.0");
});
