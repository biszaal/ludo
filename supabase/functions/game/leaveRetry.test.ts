/**
 * Deno tests for a mid-game Leave that loses the state_version race (room.ts).
 *
 * Found in the 2026-11-15 rehearsal: a player tapped Leave in a live quick match
 * while another write to the same game was in flight (their own app's autopilot
 * roll). opLeave's conditional update matched no row, it answered with the fresh
 * state, and the leave was simply gone — the app was already on Home, the seat
 * stayed in the game, and the next quick-match tap was handed straight back into
 * that match. Production's opLeave has the same shape.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
// @deno-types="../_shared/engine/index.d.ts"
import { createGame, type GameState } from "../_shared/engine/index.js";
import { opLeave } from "./room.ts";
import type { SupabaseClient } from "./lib.ts";

const GAME = "11111111-2222-3333-4444-555555555555";
const ME = "aaaaaaaa-0000-0000-0000-000000000001";
const THEM = "bbbbbbbb-0000-0000-0000-000000000002";
const OTHER = "cccccccc-0000-0000-0000-000000000003";

// deno-lint-ignore no-explicit-any
type Any = any;

function fake(state: GameState, racingWrites: number) {
  const self = { version: 5, state, writes: 0, conflicts: 0, leaveLogged: 0 };
  const chain = (settle: (f: Record<string, unknown>) => unknown, filters: Record<string, unknown> = {}): Any => {
    const n: Any = {
      eq: (c: string, v: unknown) => chain(settle, { ...filters, [c]: v }),
      in: (c: string, v: unknown) => chain(settle, { ...filters, [c]: v }),
      not: () => n,
      select: () => n,
      order: () => n,
      limit: () => n,
      single: () => Promise.resolve(settle(filters)),
      maybeSingle: () => Promise.resolve(settle(filters)),
      then: (res: Any, rej: Any) => Promise.resolve(settle(filters)).then(res, rej),
    };
    return n;
  };
  const admin = {
    rpc: () => Promise.resolve({ data: true, error: null }),
    from: (table: string) => ({
      select: () =>
        chain(() => ({
          data: table === "games"
            ? { id: GAME, host_user_id: THEM, status: "active", state: self.state, state_version: self.version, is_quick: true, has_bots: false, stake: 100, atomic_quick: true }
            : [],
          error: null,
        })),
      update: (patch: Record<string, unknown>) =>
        chain((f) => {
          if (table !== "games") return { data: null, error: null };
          // Someone else's write lands between our read and our write.
          if (self.conflicts < racingWrites) {
            self.conflicts++;
            self.version++;
            return { data: null, error: null };
          }
          if (f.state_version !== self.version) return { data: null, error: null };
          self.version = patch.state_version as number;
          self.state = patch.state as GameState;
          self.writes++;
          return { data: { id: GAME }, error: null };
        }),
      insert: (row: Record<string, unknown>) => {
        if (table === "moves" && (row.action as { action?: string })?.action === "leave") self.leaveLogged++;
        return chain(() => ({ data: null, error: null }));
      },
      delete: () => chain(() => ({ data: null, error: null })),
    }),
  } as unknown as SupabaseClient;
  return { admin, self };
}

const threeHanded = () =>
  createGame(
    [
      { id: "p1", userId: ME, color: "red" },
      { id: "p2", userId: THEM, color: "yellow" },
      { id: "p3", userId: OTHER, color: "green" },
    ],
    { gameId: GAME },
  );

Deno.test("a leave that loses the version race to another write still lands", async () => {
  const f = fake(threeHanded(), 1);
  await opLeave(f.admin, ME, GAME);
  assertEquals(f.self.writes, 1);
  assertEquals(f.self.state.players.find((p) => p.userId === ME)?.hasLeft, true);
  assertEquals(f.self.leaveLogged, 1);
});

Deno.test("a leave against a game that keeps moving gives up after a few tries rather than spinning", async () => {
  const f = fake(threeHanded(), 50);
  await opLeave(f.admin, ME, GAME);
  assertEquals(f.self.writes, 0);
  // Bounded: a handful of attempts, not one per racing write.
  assertEquals(f.self.conflicts <= 4, true);
});
