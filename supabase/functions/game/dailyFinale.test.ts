/**
 * The daily-bonus gem finale pays once per arrival, not once per day.
 *
 * The streak CLAMPS at DAILY_STREAK_MAX rather than climbing, so a player who
 * keeps showing up reads `streak_day = 7` forever. The finale fired on
 * `streak === gemDay`, which was therefore true every day, against a replay
 * guard keyed per DAY — so it paid again every morning. Two users collected it
 * nine times for 45 gems before anyone looked.
 *
 * The clamp is deliberate and stays: it is why a loyal player keeps earning
 * 200 coins a day. Only the gem half was wrong.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { opDailyBonus } from "./economy.ts";
import type { SupabaseClient } from "./lib.ts";

const ME = "aaaaaaaa-0000-0000-0000-000000000001";

/** Stub: the claim RPC answers with `row`, and gem_apply records its calls. */
function stubClient(row: Record<string, unknown>) {
  const gemCalls: Record<string, unknown>[] = [];
  const client = {
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "rate_limit_hit") return Promise.resolve({ data: true, error: null });
      if (name === "daily_bonus_claim") return Promise.resolve({ data: [row], error: null });
      if (name === "gem_apply") {
        gemCalls.push(args);
        return Promise.resolve({ data: 99, error: null });
      }
      if (name === "wallet_read") return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({
            data: table === "app_config"
              ? { value: { gems: { enabled: true }, economy: { gemDay: 7, gemAmount: 5 } } }
              : { user_id: ME, balance: 500, gems: 0, streak_day: 7, last_bonus_on: null, last_pity_at: null },
            error: null,
          }),
          single: () => Promise.resolve({ data: { user_id: ME, balance: 500, gems: 0 }, error: null }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
  return { client, gemCalls };
}

const body = async (r: Response) => (await r.json()) as { gemsClaimed?: number; streakDay?: number };

Deno.test("arriving at the finale pays the gems", async () => {
  // 6 -> 7 is the real transition, and the only one worth paying for.
  const { client, gemCalls } = stubClient({
    balance: 700, streak_day: 7, claimed: 200, already: false, prev_streak_day: 6,
  });
  const res = await opDailyBonus(client, ME);

  assertEquals((await body(res)).gemsClaimed, 5);
  assertEquals(gemCalls.length, 1, "the finale should credit exactly once");
});

Deno.test("sitting on the finale a second day pays nothing", async () => {
  // The bug, exactly: clamped at 7, so streak_day is 7 again today.
  const { client, gemCalls } = stubClient({
    balance: 900, streak_day: 7, claimed: 200, already: false, prev_streak_day: 7,
  });
  const res = await opDailyBonus(client, ME);

  assertEquals((await body(res)).gemsClaimed, 0);
  assertEquals(gemCalls.length, 0, "a clamped streak must not re-pay the finale");
  // The COIN half is untouched — this is why the clamp stays.
  assertEquals((await body(await opDailyBonus(stubClient({
    balance: 900, streak_day: 7, claimed: 200, already: false, prev_streak_day: 7,
  }).client, ME))).streakDay, 7);
});

Deno.test("a day short of the finale pays nothing", async () => {
  const { client, gemCalls } = stubClient({
    balance: 675, streak_day: 6, claimed: 175, already: false, prev_streak_day: 5,
  });
  assertEquals((await body(await opDailyBonus(client, ME))).gemsClaimed, 0);
  assertEquals(gemCalls.length, 0);
});

Deno.test("rebuilding a broken streak pays the finale again", async () => {
  // Missing a day resets to 1; climbing back to 7 is a fresh achievement.
  const { client, gemCalls } = stubClient({
    balance: 700, streak_day: 7, claimed: 200, already: false, prev_streak_day: 6,
  });
  assertEquals((await body(await opDailyBonus(client, ME))).gemsClaimed, 5);
  assertEquals(gemCalls.length, 1);
});

Deno.test("an old server that sends no prev_streak keeps the paying behaviour", async () => {
  // Half-deployed stack: withholding someone's bonus is worse than the leak,
  // and the per-day ext_id still bounds it to once a day.
  const { client, gemCalls } = stubClient({
    balance: 700, streak_day: 7, claimed: 200, already: false,
  });
  assertEquals((await body(await opDailyBonus(client, ME))).gemsClaimed, 5);
  assertEquals(gemCalls.length, 1);
});
