/**
 * The watchdog for a failure that produces no errors.
 *
 * When AdMob's SSV callback URL is missing from an ad unit, Google never calls
 * the endpoint at all — no failed request, no rejected signature, nothing in
 * any log. The only trace is in this table.
 *
 * The hard part is the THRESHOLD, not the detection. `pending` is the ordinary
 * outcome of a rewarded ad, not an alarming one: on 2026-08-24, with SSV
 * confirmed working end to end, only 8 of 32 intents were granted. At a 25%
 * grant rate, three pending-only intents happen 42% of the time by chance — so
 * the first cut of this watchdog would have fired on nearly every quiet spell.
 * These tests pin it well clear of the noise floor.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { opTick } from "./tick.ts";
import type { SupabaseClient } from "./lib.ts";

const SECRET = "tick-secret";

/** Stub with no games to settle or advance, and the given ad_rewards counts. */
function stubClient(counts: { granted: number; pending: number }): SupabaseClient {
  return {
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: (table: string) => {
      if (table === "ad_rewards") {
        return {
          select: () => ({
            eq: (_col: string, status: string) => ({
              gte: () => Promise.resolve({
                count: status === "granted" ? counts.granted : counts.pending,
                error: null,
              }),
            }),
          }),
        };
      }
      // games: nothing to settle, nothing stalled.
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ gt: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
            not: () => ({
              lt: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
            }),
          }),
        }),
      };
    },
  } as unknown as SupabaseClient;
}

function tickRequest(secret = SECRET): Request {
  return new Request("https://example.test/game", {
    method: "POST",
    headers: { "x-tick-secret": secret },
  });
}

const body = async (res: Response) =>
  (await res.json()) as { ok?: boolean; adRewardsHealthy?: boolean | null; error?: string };

Deno.env.set("TICK_SECRET", SECRET);

Deno.test("a large window of intents with zero grants reads as unhealthy", async () => {
  // Twelve is where "no grants" stops being plausible noise: 0.75^12 ≈ 3%.
  const res = await opTick(stubClient({ granted: 0, pending: 12 }), tickRequest());
  assertEquals((await body(res)).adRewardsHealthy, false);
});

Deno.test("five pending intents are NOT enough to call it broken", async () => {
  // The production shape on 2026-08-28, which the first pass of this audit read
  // as a four-day outage. At the historical 25% grant rate it happens 24% of
  // the time with a perfectly healthy pipeline — a coincidence, not a signal.
  const res = await opTick(stubClient({ granted: 0, pending: 5 }), tickRequest());
  assertEquals((await body(res)).adRewardsHealthy, null);
});

Deno.test("any grant in the window reads as healthy", async () => {
  // The real 2026-08-24 shape: 22 pending against a handful of grants, on a day
  // the pipeline demonstrably worked. Pending rows are normal — a player who
  // dismisses the ad leaves one — so the signal is the ABSENCE of grants, never
  // the presence of pending.
  const res = await opTick(stubClient({ granted: 1, pending: 22 }), tickRequest());
  assertEquals((await body(res)).adRewardsHealthy, true);
});

Deno.test("too little traffic is reported as unknown, not as broken", async () => {
  // A quiet night on a small game must not page anyone. At today's volume this
  // is the usual answer, and staying silent on thin data is the point.
  for (const pending of [0, 2, 8, 11]) {
    const res = await opTick(stubClient({ granted: 0, pending }), tickRequest());
    assertEquals(
      (await body(res)).adRewardsHealthy,
      null,
      `${pending} pending intents should read as unknown, not broken`,
    );
  }
});

Deno.test("the health check never runs for an unauthenticated caller", async () => {
  const res = await opTick(stubClient({ granted: 0, pending: 99 }), tickRequest("wrong"));
  const b = await body(res);
  assertEquals(b.error, "Not authenticated.");
  assertEquals(b.adRewardsHealthy, undefined);
});
