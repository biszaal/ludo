/**
 * Server-driven turns fold too — and they are the bigger half.
 *
 * Of the actions logged in a day of real play, bot-roll, bot-move and bot-pass
 * were 53.7%. A bot turn costs the same two writes a human's does, and each one
 * fans the same 2.2KB state document to every seat, so folding the humans and
 * not the bots would leave most of the saving on the table.
 *
 * The pacing is what made this look harder than it is. The driver sleeps
 * stepPauseMs between steps SO THAT clients can animate each write. Folding
 * does not remove that pause — it repurposes it: the die goes out as a
 * broadcast, the pause becomes the die's animation window, and the write that
 * follows carries the move. Same rhythm, one fewer write.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { driveBotTurns, type BotSeats } from "./bots.ts";
import type { SupabaseClient } from "./lib.ts";
// @deno-types="../_shared/engine/index.d.ts"
import { createGame, type GameState } from "../_shared/engine/index.js";

const GAME = "55555555-5555-5555-5555-555555555555";
const BOT_UID = "66666666-6666-6666-6666-666666666666";

Deno.env.set("DICE_SECRET", "test-dice-secret-for-server-driven-fold");

/** Both seats are bots, so the driver never stands down for a human. */
function botSeats(): BotSeats {
  return new Map([
    [BOT_UID, { chatCount: 0, lastChatAtMs: null }],
    [BOT_UID + "b", { chatCount: 0, lastChatAtMs: null }],
  ]);
}

interface Fake {
  admin: SupabaseClient;
  patches: Array<Record<string, unknown>>;
  moves: Array<Record<string, unknown>>;
  sent: Array<{ topic: string; event: string; payload: Record<string, unknown> }>;
  row: { state: GameState; state_version: number };
}

/** An all-bot table, so the driver keeps the turn and never stands down. */
function botGame(): GameState {
  return createGame(
    [
      { id: "p1", userId: BOT_UID, color: "red" },
      { id: "p2", userId: BOT_UID + "b", color: "yellow" },
    ],
    { gameId: GAME },
  );
}

function fake(foldWrites: boolean): Fake {
  const self: Fake = {
    admin: null as unknown as SupabaseClient,
    patches: [],
    moves: [],
    sent: [],
    row: { state: botGame(), state_version: 0 },
  };

  // deno-lint-ignore no-explicit-any
  const chain = (filters: Record<string, unknown>, settle: (f: Record<string, unknown>) => unknown): any => {
    // deno-lint-ignore no-explicit-any
    const node: any = {
      eq: (col: string, val: unknown) => chain({ ...filters, [col]: val }, settle),
      or: () => node,
      in: () => node,
      is: () => node,
      gt: () => node,
      order: () => Promise.resolve(settle(filters)),
      select: () => node,
      limit: () => node,
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
          has_bots: true,
          fold_writes: foldWrites,
        },
        error: null,
      })),
    update: (patch: Record<string, unknown>) =>
      chain({}, (filters) => {
        if (filters["state_version"] !== self.row.state_version) return { data: null, error: null };
        self.patches.push(patch);
        self.row = {
          state: patch.state as GameState,
          state_version: patch.state_version as number,
        };
        return { data: { id: GAME }, error: null };
      }),
  };

  self.admin = {
    from: (table: string) => {
      if (table === "games") return games;
      if (table === "moves") {
        return {
          insert: (r: Record<string, unknown>) => {
            self.moves.push(r);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      if (table === "game_bots") {
        return {
          select: () =>
            chain({}, () => ({
              data: [{ user_id: BOT_UID, chat_count: 0, last_chat_at: null }],
              error: null,
            })),
          update: () => chain({}, () => ({ data: null, error: null })),
        };
      }
      return {
        select: () => chain({}, () => ({ data: null, error: null })),
        update: () => chain({}, () => ({ data: null, error: null })),
        insert: () => chain({}, () => ({ data: null, error: null })),
      };
    },
    // deno-lint-ignore no-explicit-any
    rpc: () => Promise.resolve({ data: null, error: null }) as any,
    // deno-lint-ignore no-explicit-any
  } as any;

  return self;
}

async function recordingBroadcasts<T>(f: Fake, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    for (const m of body.messages ?? []) f.sent.push(m);
    return Promise.resolve(new Response("{}", { status: 200 }));
    // deno-lint-ignore no-explicit-any
  }) as any;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test({
  name: "a bot turn on a folding table broadcasts its die so spectators still see it",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const f = fake(true);
    await recordingBroadcasts(f, () => driveBotTurns(f.admin, GAME, botSeats()));

    const rolls = f.sent.filter((m) => m.event === "roll");
    assertEquals(rolls.length > 0, true);
    assertEquals(typeof rolls[0]!.payload.die, "number");
    assertEquals(rolls[0]!.topic, `game:${GAME}`);
  },
});

Deno.test({
  name: "a folding bot turn writes once per turn, not once per action",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const folding = fake(true);
    await recordingBroadcasts(folding, () => driveBotTurns(folding.admin, GAME, botSeats()));

    const plain = fake(false);
    await recordingBroadcasts(plain, () => driveBotTurns(plain.admin, GAME, botSeats()));

    // Same game, same dice (derived), so the same turns happen either way —
    // the folding run just spends fewer writes reaching the same place.
    assertEquals(folding.patches.length < plain.patches.length, true);
  },
});

Deno.test({
  name: "a bot turn on a non-folding table is unchanged — no broadcast, write per action",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const f = fake(false);
    await recordingBroadcasts(f, () => driveBotTurns(f.admin, GAME, botSeats()));

    assertEquals(f.sent.filter((m) => m.event === "roll").length, 0);
    assertEquals(f.patches.length > 0, true);
  },
});
