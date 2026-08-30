/**
 * Authorization on the one rewarded placement sized from caller input.
 *
 * Every other placement pays a fixed amount this server owns, so the request
 * body cannot influence the payout. `double-pot` is computed from a game the
 * CALLER names, which makes that game id an input that has to be authorized —
 * and until the 2026-08-28 audit it wasn't: any signed-in caller could name any
 * game, including one they lost or were never seated in, and be paid half its
 * pot. At the top stake tier that is 20,000 coins a grant, three a day.
 *
 * These tests pin the three checks and, just as importantly, that all four
 * refusals are the SAME string — three different messages would tell a prober
 * which check they got past.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { opAdRewardIntent } from "./economy.ts";
import type { SupabaseClient } from "./lib.ts";

const ME = "aaaaaaaa-0000-0000-0000-000000000001";
const RIVAL = "bbbbbbbb-0000-0000-0000-000000000002";
const GAME = "11111111-2222-3333-4444-555555555555";

const MY_SEAT = "seat-mine";
const RIVAL_SEAT = "seat-rival";

/** A finished 4-player table at the top tier — the most valuable target. */
function gameRow(opts: { status?: string; winner?: string | null; seatedUsers?: string[] }) {
  const seated = opts.seatedUsers ?? [ME, RIVAL];
  return {
    stake: 10000,
    status: opts.status ?? "finished",
    state: {
      status: "finished",
      players: seated.map((userId, i) => ({ id: i === 0 ? MY_SEAT : RIVAL_SEAT, userId })),
      finishedOrder: opts.winner === undefined ? [MY_SEAT] : opts.winner ? [opts.winner] : [],
      winnerPlayerId: opts.winner === undefined ? MY_SEAT : opts.winner,
    },
  };
}

/**
 * Stub covering the reads opAdRewardIntent makes:
 *   rpc("rate_limit_hit")            -> allowed
 *   from("ad_rewards").select(count) -> 0 grants used today
 *   from("games").select().maybeSingle() -> `game`, or null for "no such game"
 *   from("ad_rewards").insert()      -> the minted intent
 */
function stubClient(game: unknown): { client: SupabaseClient; inserted: Record<string, unknown>[] } {
  const inserted: Record<string, unknown>[] = [];
  const client = {
    rpc: () => Promise.resolve({ data: true, error: null }),
    from: (table: string) => {
      if (table === "games") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: game, error: null }) }) }),
        };
      }
      // ad_rewards: the daily-cap count, then the insert.
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({ gte: () => Promise.resolve({ count: 0, error: null }) }),
            }),
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return {
            select: () => ({
              single: () => Promise.resolve({
                data: { id: "reward-row", coins: row.coins, currency: row.currency },
                error: null,
              }),
            }),
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, inserted };
}

const body = async (res: Response) => (await res.json()) as { error?: string; coins?: number };

/** The single refusal every failed double-pot check returns. */
const REFUSAL = "Nothing to award here.";

Deno.test("the winner of a finished game they played in is paid half the pot", async () => {
  const { client, inserted } = stubClient(gameRow({ winner: MY_SEAT }));
  const res = await opAdRewardIntent(client, ME, "double-pot", GAME);

  // floor(stake 10000 * 2 seats / 2)
  assertEquals((await body(res)).coins, 10000);
  assertEquals(inserted.length, 1);
  assertEquals(inserted[0]!.coins, 10000);
});

Deno.test("a player who lost the game gets nothing", async () => {
  // The exploit as it stood: play a high-stake table, lose, claim anyway.
  const { client, inserted } = stubClient(gameRow({ winner: RIVAL_SEAT }));
  const res = await opAdRewardIntent(client, ME, "double-pot", GAME);

  assertEquals((await body(res)).error, REFUSAL);
  assertEquals(inserted.length, 0, "a losing claim must mint no intent");
});

Deno.test("a caller who never held a seat gets nothing", async () => {
  // Naming a stranger's game id — no seat, so no claim on its pot.
  const { client, inserted } = stubClient(gameRow({ seatedUsers: [RIVAL, "cccccccc-0000-0000-0000-000000000003"] }));
  const res = await opAdRewardIntent(client, ME, "double-pot", GAME);

  assertEquals((await body(res)).error, REFUSAL);
  assertEquals(inserted.length, 0);
});

Deno.test("a game still in progress gets nothing", async () => {
  // Otherwise the reward is claimable mid-match, repeatedly, before anyone wins.
  const { client, inserted } = stubClient(gameRow({ status: "active", winner: MY_SEAT }));
  const res = await opAdRewardIntent(client, ME, "double-pot", GAME);

  assertEquals((await body(res)).error, REFUSAL);
  assertEquals(inserted.length, 0);
});

Deno.test("an unknown game id gets nothing", async () => {
  const { client, inserted } = stubClient(null);
  const res = await opAdRewardIntent(client, ME, "double-pot", GAME);

  assertEquals((await body(res)).error, REFUSAL);
  assertEquals(inserted.length, 0);
});

Deno.test("every refusal reads identically, so it cannot be used as an oracle", async () => {
  const cases = [
    gameRow({ winner: RIVAL_SEAT }),                                   // lost
    gameRow({ seatedUsers: [RIVAL, "cccccccc-0000-0000-0000-000000000003"] }), // not seated
    gameRow({ status: "active", winner: MY_SEAT }),                    // unfinished
    null,                                                              // no such game
  ];
  for (const g of cases) {
    const { client } = stubClient(g);
    const res = await opAdRewardIntent(client, ME, "double-pot", GAME);
    assertEquals((await body(res)).error, REFUSAL);
  }
});

Deno.test("double-pot without a game id is refused before any lookup", async () => {
  const { client, inserted } = stubClient(gameRow({ winner: MY_SEAT }));
  const res = await opAdRewardIntent(client, ME, "double-pot", null);

  assertEquals((await body(res)).error, "Missing game.");
  assertEquals(inserted.length, 0);
});
