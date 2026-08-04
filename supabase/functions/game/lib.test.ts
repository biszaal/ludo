/**
 * Deno tests for the game function's shared primitives.
 *
 * The server owns the dice, the payouts and the economy, and until now had no
 * tests at all — the 334 on the client cover the engine and the stores, neither
 * of which can catch a server-side regression. This is the first slice: the two
 * behaviours added for production hardening, where getting it wrong is silent.
 *
 *   npm run test:edge
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { LIMITS, rateLimited, rateOk, safeError, WRITE_FAILED } from "./lib.ts";
import type { SupabaseClient } from "./lib.ts";

/** Minimal stand-in for the bits of the client these helpers touch. */
function stubClient(rpc: (name: string, args: unknown) => { data: unknown; error: unknown }): SupabaseClient {
  return { rpc: (name: string, args: unknown) => Promise.resolve(rpc(name, args)) } as unknown as SupabaseClient;
}

const body = async (res: Response) => (await res.json()) as { error?: string };

// --- safeError ---------------------------------------------------------------

Deno.test("safeError keeps Postgres detail out of the response", async () => {
  const leak = new Error(
    'duplicate key value violates unique constraint "profiles_display_name_ci_unique"',
  );
  const res = safeError("test.write", leak, WRITE_FAILED);
  const json = await body(res);

  assertEquals(json.error, WRITE_FAILED);
  // The things an attacker would actually want out of an error.
  for (const secret of ["constraint", "profiles_", "duplicate key"]) {
    assertEquals(
      json.error!.includes(secret),
      false,
      `response leaked "${secret}"`,
    );
  }
});

Deno.test("safeError still answers 200 with an { error } body (file convention)", async () => {
  const res = safeError("test.write", new Error("boom"));
  assertEquals(res.status, 200);
  assertStringIncludes((await body(res)).error ?? "", "went wrong");
});

Deno.test("safeError survives a non-Error throw", async () => {
  // Deno/Postgrest can reject with a plain object; this must not itself throw.
  const res = safeError("test.write", { code: "42501" });
  assertEquals((await body(res)).error, "Something went wrong. Try again.");
});

// --- rateOk ------------------------------------------------------------------

Deno.test("rateOk passes the bucket and limit through to the counter", async () => {
  let seen: unknown = null;
  const admin = stubClient((name, args) => {
    assertEquals(name, "rate_limit_hit");
    seen = args;
    return { data: true, error: null };
  });

  assertEquals(await rateOk(admin, "user-1", "shopBuy", LIMITS.shopBuy), true);
  assertEquals(seen, { p_user: "user-1", p_bucket: "shopBuy", p_limit: LIMITS.shopBuy });
});

Deno.test("rateOk refuses once the counter reports the budget spent", async () => {
  const admin = stubClient(() => ({ data: false, error: null }));
  assertEquals(await rateOk(admin, "user-1", "adReward", LIMITS.adReward), false);
});

Deno.test("rateOk FAILS OPEN when the counter itself errors", async () => {
  // Deliberate: a limiter that locks players out of their own wallet because
  // rate_limits hiccuped is worse than the abuse it prevents. The per-UTC-day
  // economic caps still hold underneath.
  const admin = stubClient(() => ({ data: null, error: { message: "relation does not exist" } }));
  assertEquals(await rateOk(admin, "user-1", "walletTopup", LIMITS.walletTopup), true);
});

Deno.test("every limit is a positive number a human cannot reach by playing", async () => {
  for (const [name, limit] of Object.entries(LIMITS)) {
    assertEquals(Number.isInteger(limit) && limit > 0, true, `${name} is not a positive integer`);
    assertEquals(limit >= 10, true, `${name} (${limit}) is low enough to hit in normal play`);
  }
});

Deno.test("rateLimited is a player-readable refusal, not a status code", async () => {
  const res = rateLimited();
  assertEquals(res.status, 200);
  assertStringIncludes((await body(res)).error ?? "", "too fast");
});
