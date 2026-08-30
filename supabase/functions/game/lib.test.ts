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
import { createTouchGate, deepMerge, LIMITS, rateLimited, rateOk, safeError, secretMatches, WRITE_FAILED } from "./lib.ts";
import type { SupabaseClient } from "./lib.ts";
import { collectStakes, payingSeats } from "./deal.ts";

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

// --- collectStakes (room pots) ----------------------------------------------
//
// The all-or-nothing collection in deal.ts. Its failure mode is silent and
// expensive: a partial collection takes real coins from players for a game that
// never starts, and nobody involved can see that it happened.

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Stub wallet. `broke` names users whose debit overdraws (wallet_apply returns
 * null); everything else succeeds. Records every call so the test can assert
 * on what actually moved.
 */
function stakeClient(broke: Set<string>, calls: RpcCall[]): SupabaseClient {
  return {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const user = String(args.p_user);
      const delta = Number(args.p_delta);
      if (name === "wallet_apply" && delta < 0 && broke.has(user)) {
        return Promise.resolve({ data: null, error: { message: "insufficient" } });
      }
      return Promise.resolve({ data: 500, error: null });
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: { display_name: "Dana" }, error: null }) }),
      }),
    }),
  } as unknown as SupabaseClient;
}

const seats = (...ids: string[]) => ids.map((user_id) => ({ user_id }));

Deno.test("collectStakes debits every seat once when all can pay", async () => {
  const calls: RpcCall[] = [];
  const res = await collectStakes(stakeClient(new Set(), calls), "g1", seats("a", "b", "c"), 100);

  assertEquals(res, { ok: true });
  const debits = calls.filter((c) => Number(c.args.p_delta) < 0);
  assertEquals(debits.length, 3);
  assertEquals(debits.map((c) => c.args.p_user), ["a", "b", "c"]);
  assertEquals(calls.filter((c) => Number(c.args.p_delta) > 0).length, 0);
});

Deno.test("collectStakes carries a per-seat ext_id so a retry can't double-charge", async () => {
  const calls: RpcCall[] = [];
  await collectStakes(stakeClient(new Set(), calls), "g1", seats("a", "b"), 100);

  assertEquals(calls[0]!.args.p_ext_id, "room-stake:g1:a");
  assertEquals(calls[1]!.args.p_ext_id, "room-stake:g1:b");
});

Deno.test("collectStakes refunds everyone already charged when a seat is short", async () => {
  const calls: RpcCall[] = [];
  // Third seat of four is broke: a and b must get their coins back, and d
  // must never be charged at all.
  const res = await collectStakes(stakeClient(new Set(["c"]), calls), "g1", seats("a", "b", "c", "d"), 250);

  assertStringIncludes((res as { error: string }).error, "Dana");

  const debited = calls.filter((c) => Number(c.args.p_delta) < 0).map((c) => c.args.p_user);
  assertEquals(debited, ["a", "b", "c"]);

  const refunded = calls.filter((c) => Number(c.args.p_delta) > 0);
  assertEquals(refunded.map((c) => c.args.p_user), ["a", "b"]);
  assertEquals(refunded.map((c) => c.args.p_delta), [250, 250]);
  assertEquals(refunded.map((c) => c.args.p_reason), ["stake-refund", "stake-refund"]);
});

Deno.test("collectStakes leaves refunds un-deduped so the unwind can't no-op", async () => {
  // A refund sharing the debit's ext_id would be swallowed by the replay guard
  // and the rollback would silently do nothing.
  const calls: RpcCall[] = [];
  await collectStakes(stakeClient(new Set(["b"]), calls), "g1", seats("a", "b"), 100);

  const refund = calls.find((c) => Number(c.args.p_delta) > 0)!;
  assertEquals(refund.args.p_ext_id, null);
});

// --- payingSeats (who funds a friend-room pot) --------------------------------

Deno.test("payingSeats excludes bot seats from the pot", () => {
  // A host filling a 3-friend room seats one bot. Charging it would take coins
  // from a pooled wallet, and once that ran dry the all-or-nothing collection
  // would fail and block the start for everyone.
  const lobby = seats("a", "b", "c", "bot1");
  assertEquals(payingSeats(lobby, new Set(["bot1"])).map((s) => s.user_id), ["a", "b", "c"]);
});

Deno.test("payingSeats charges everyone when there are no bots", () => {
  const lobby = seats("a", "b");
  assertEquals(payingSeats(lobby, new Set()).map((s) => s.user_id), ["a", "b"]);
});

Deno.test("payingSeats can empty the pot when every remaining seat is a bot", () => {
  // A solo host who filled the table: nobody pays in, and finish.ts pays only
  // them — the house covers the other three seats either way.
  assertEquals(payingSeats(seats("bot1", "bot2"), new Set(["bot1", "bot2"])), []);
});

// --- secretMatches -----------------------------------------------------------
// Shared by the two secret-authed cron entrypoints (opTick, opSweepGuests). Both
// gate destructive work, so a compare that leaks or that returns true too
// readily is the whole security model of those paths.

Deno.test("secretMatches accepts only the exact secret", () => {
  assertEquals(secretMatches("s3cret", "s3cret"), true);
  assertEquals(secretMatches("s3cret", "s3crex"), false);
});

Deno.test("secretMatches rejects a length mismatch outright", () => {
  // The early return is the one place the compare is not constant-time, and it
  // leaks length only — which the caller's secret is free to be long enough for.
  assertEquals(secretMatches("short", "muchlongersecret"), false);
  assertEquals(secretMatches("", "nonempty"), false);
});

Deno.test("secretMatches is true for empty vs empty, so callers must check first", () => {
  // Pinning the fail-OPEN shape deliberately: this is why opTick and
  // opSweepGuests both test `!expected` BEFORE calling. If that guard is ever
  // dropped, an unconfigured environment becomes an open endpoint.
  assertEquals(secretMatches("", ""), true);
});

// --- createTouchGate ---------------------------------------------------------
// Bounds how often the router spends a round trip recording that a user is
// alive. touch_activity already bounds the WRITE in SQL; this bounds the CALL,
// because opTurn fires several times per player per minute.

Deno.test("touch gate lets the first sighting of a user through", () => {
  const gate = createTouchGate();
  assertEquals(gate.should("a", 1_000), true);
});

Deno.test("touch gate swallows repeats inside the window", () => {
  // Without this a 30-minute four-player match costs ~400 round trips to record
  // 4 facts, every one of them a no-op at the database.
  const gate = createTouchGate(30 * 60_000);
  assertEquals(gate.should("a", 0), true);
  assertEquals(gate.should("a", 60_000), false);
  assertEquals(gate.should("a", 29 * 60_000), false);
});

Deno.test("touch gate reopens once the window has passed", () => {
  const gate = createTouchGate(30 * 60_000);
  assertEquals(gate.should("a", 0), true);
  assertEquals(gate.should("a", 31 * 60_000), true);
});

Deno.test("touch gate tracks users independently", () => {
  // One busy player must not suppress the recording of everyone else — that
  // would age live users toward deletion.
  const gate = createTouchGate(30 * 60_000);
  assertEquals(gate.should("a", 0), true);
  assertEquals(gate.should("b", 0), true);
  assertEquals(gate.should("a", 0), false);
});

Deno.test("touch gate stays bounded in a long-lived isolate", () => {
  const gate = createTouchGate(30 * 60_000, 100);
  for (let i = 0; i < 500; i++) gate.should(`u${i}`, i);
  // Eviction drops the oldest half when full, so the map oscillates below the
  // cap rather than growing forever.
  assertEquals(gate.size() <= 100, true);
});

Deno.test("an evicted user is simply asked again", () => {
  // Eviction must be lossy in the SAFE direction: forgetting someone costs one
  // extra round trip, which the SQL guard turns into a no-op. It must never
  // cause a user to be skipped.
  const gate = createTouchGate(30 * 60_000, 4);
  assertEquals(gate.should("a", 0), true);
  for (let i = 0; i < 10; i++) gate.should(`filler${i}`, 1);
  assertEquals(gate.should("a", 2), true);
});

// --- deepMerge ---------------------------------------------------------------

Deno.test("deepMerge cannot be used to reach the prototype", () => {
  // `JSON.parse` yields __proto__ as an OWN enumerable property, so it survives
  // Object.entries — and `out[k] = v` on a plain object then hits the prototype
  // SETTER rather than defining a key. Both inputs are app_config rows today,
  // so only an operator can reach this; the guard is what keeps that true if a
  // config value ever becomes region-supplied.
  const hostile = JSON.parse('{"__proto__": {"polluted": "yes"}}');
  const merged = deepMerge({ ads: { enabled: true } }, hostile);

  assertEquals(({} as Record<string, unknown>).polluted, undefined, "Object.prototype was polluted");
  assertEquals((merged as Record<string, unknown>).polluted, undefined);
  // The legitimate half of the document is untouched.
  assertEquals((merged.ads as Record<string, unknown>).enabled, true);
});

Deno.test("deepMerge ignores constructor and prototype keys too", () => {
  const merged = deepMerge({}, JSON.parse('{"constructor": "x", "prototype": "y", "keep": 1}'));
  assertEquals(merged.constructor, Object);
  assertEquals(merged.prototype, undefined);
  // Everything not on the deny list still merges normally.
  assertEquals(merged.keep, 1);
});

Deno.test("deepMerge still deep-merges, with the override winning", () => {
  const merged = deepMerge(
    { ads: { rewarded: { gemGrant: true }, interstitial: 60 }, economy: { stakeTiers: [100] } },
    { ads: { interstitial: 90 }, economy: { stakeTiers: [100, 1000] } },
  );
  // Nested object: the untouched sibling survives, the named key is replaced.
  assertEquals((merged.ads as Record<string, unknown>).interstitial, 90);
  assertEquals(((merged.ads as Record<string, unknown>).rewarded as Record<string, unknown>).gemGrant, true);
  // Arrays replace wholesale rather than concatenating.
  assertEquals((merged.economy as Record<string, unknown>).stakeTiers, [100, 1000]);
});
