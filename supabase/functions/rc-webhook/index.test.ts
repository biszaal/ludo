/**
 * The gate between a purchase nobody paid for and real, spendable gems.
 *
 * The webhook used to read `event.environment` and use it only to pick a ledger
 * label — `iap-sandbox` versus `iap` — while crediting the full product amount
 * either way. Sandbox is reachable by TestFlight testers, Play licence testers,
 * and any device that can force StoreKit's sandbox, so that minted free
 * currency; and gems exchange one-way into coins that are staked against other
 * players, which is the one thing the 0018 fairness invariant forbids. One such
 * credit exists in production (60 gems, 2026-07-28).
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { creditable, productGems } from "./index.ts";
import { secretMatches } from "../_shared/secret.ts";

Deno.test("a production purchase credits", () => {
  assertEquals(creditable("PRODUCTION", {}), true);
});

Deno.test("a sandbox purchase does not credit by default", () => {
  // The whole finding. Absent config must read as "no".
  assertEquals(creditable("SANDBOX", {}), false);
  assertEquals(creditable("SANDBOX", { creditSandboxPurchases: false }), false);
});

Deno.test("only an explicit true re-enables sandbox credits", () => {
  // The staging escape hatch, in the same shape as gems.allowStubProvider:
  // never seeded, and nothing truthy-but-not-true opens it.
  assertEquals(creditable("SANDBOX", { creditSandboxPurchases: true }), true);
  for (const loose of ["true", 1, {}, []]) {
    assertEquals(
      creditable("SANDBOX", { creditSandboxPurchases: loose }),
      false,
      `${JSON.stringify(loose)} must not open the gate`,
    );
  }
});

Deno.test("the environment check is case-insensitive and fails closed", () => {
  // RevenueCat sends "SANDBOX", but a casing change upstream must not silently
  // turn crediting back on.
  assertEquals(creditable("sandbox", {}), false);
  assertEquals(creditable("Sandbox", {}), false);
  // An environment we don't recognise is treated as production — RC always
  // sends one, and refusing every unknown value would stop real purchases.
  assertEquals(creditable("", {}), true);
});

Deno.test("server config overrides the built-in product map", () => {
  assertEquals(productGems({})["gems.small"], 60);
  const overridden = productGems({ products: [{ id: "gems.small", gems: 99 }] });
  assertEquals(overridden["gems.small"], 99);
  // Unlisted products keep their fallback rather than vanishing.
  assertEquals(overridden["gems.large"], 750);
});

Deno.test("the webhook secret compares in constant time", () => {
  // Was a plain `!==`, which short-circuits on the first differing byte, on the
  // only path that mints paid currency.
  assertEquals(secretMatches("hunter2", "hunter2"), true);
  assertEquals(secretMatches("hunter3", "hunter2"), false);
  assertEquals(secretMatches("", "hunter2"), false);
  assertEquals(secretMatches("hunter2extra", "hunter2"), false);
});
