/**
 * Reward spin (0086), edge side: the two ops are thin wrappers. Every rule —
 * what is owed, the draw, the payout, retries — lives in SQL and is tested in
 * scripts/tests/spin.test.mjs. These tests pin what the wrappers add: input
 * checks, the rate limit, and that errors never look like a result.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "./lib.ts";
import { opSpinClaim, opSpinState } from "./spin.ts";

const ME = "11111111-1111-1111-1111-111111111111";
const REQ = "22222222-2222-4222-8222-222222222222";

function fake(rpc: Record<string, (args: Record<string, unknown>) => { data?: unknown; error?: unknown }>) {
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  const admin = {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      const handler = rpc[name];
      return Promise.resolve(handler ? { error: null, ...handler(args) } : { data: null, error: null });
    },
  } as unknown as SupabaseClient;
  return { admin, calls: (name: string) => rpcs.filter((r) => r.name === name) };
}

const body = async (res: Response) => await res.json();

Deno.test("spinState passes the status through", async () => {
  const status = { enabled: true, owed: { first: "locked", daily: true, match: 0 }, next: null };
  const f = fake({ spin_status: () => ({ data: status }) });
  assertEquals(await body(await opSpinState(f.admin, ME)), status);
  assertEquals(f.calls("spin_status")[0].args, { p_user: ME });
});

Deno.test("spinClaim sends the user, source and request id", async () => {
  const result = { ok: true, segment: 0, prize: { coins: 25 }, balance: 125, gems: 0, status: { enabled: true } };
  const f = fake({ spin_claim: () => ({ data: result }) });
  assertEquals(await body(await opSpinClaim(f.admin, ME, "daily", REQ)), result);
  assertEquals(f.calls("spin_claim")[0].args, { p_user: ME, p_source: "daily", p_request_id: REQ });
});

Deno.test("spinClaim passes a refusal through", async () => {
  const f = fake({ spin_claim: () => ({ data: { ok: false, reason: "not_owed" } }) });
  assertEquals(await body(await opSpinClaim(f.admin, ME, "match", REQ)), { ok: false, reason: "not_owed" });
});

Deno.test("spinClaim refuses a bad source or request id without calling the database", async () => {
  for (const [source, req] of [["weekly", REQ], ["", REQ], ["daily", "not-a-uuid"], ["daily", ""]]) {
    const f = fake({ spin_claim: () => ({ data: { ok: true } }) });
    assertEquals(await body(await opSpinClaim(f.admin, ME, source, req)), { error: "Bad request." }, `${source}/${req}`);
    assertEquals(f.calls("spin_claim").length, 0);
  }
});

Deno.test("a database error is never mistaken for a result", async () => {
  const f = fake({
    spin_status: () => ({ data: null, error: { message: "boom" } }),
    spin_claim: () => ({ data: null, error: { message: "boom" } }),
  });
  assertEquals(await body(await opSpinState(f.admin, ME)), { error: "Could not spin. Try again." });
  assertEquals(await body(await opSpinClaim(f.admin, ME, "daily", REQ)), { error: "Could not spin. Try again." });
});

Deno.test("the rate limit stops both ops before the database, each with its own budget", async () => {
  const f = fake({ rate_limit_hit: () => ({ data: false }), spin_status: () => ({ data: {} }), spin_claim: () => ({ data: {} }) });
  assertEquals((await body(await opSpinState(f.admin, ME))).error, "You're doing that too fast. Give it a minute.");
  assertEquals((await body(await opSpinClaim(f.admin, ME, "daily", REQ))).error, "You're doing that too fast. Give it a minute.");
  assertEquals(f.calls("spin_status").length + f.calls("spin_claim").length, 0);
  // Home reads the state on every visit; claims are a few taps a day.
  assertEquals(
    f.calls("rate_limit_hit").map((c) => [c.args.p_bucket, c.args.p_limit]),
    [["spinState", 120], ["spinClaim", 30]],
  );
});

// The spin block (tables, allowlist of test accounts) is server-only: the
// `config` op sends app_config to every app, so it must leave `spin` out.
Deno.test("the config op never sends the spin block to apps", async () => {
  const { opConfig } = await import("./economy.ts");
  const rows = [
    { key: "default", value: { ads: { enabled: true }, spin: { enabled: false, allowlistUserIds: [ME] } } },
    { key: "NP", value: { spin: { enabled: true } } },
  ];
  const admin = {
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: () => ({ select: () => ({ in: () => Promise.resolve({ data: rows, error: null }) }) }),
  } as unknown as SupabaseClient;
  const res = await body(await opConfig(admin, ME, new Request("https://x/", { method: "POST" }), "NP"));
  assertEquals(res.config, { ads: { enabled: true } });
  assertEquals(res.region, "NP");
});
