/**
 * Install source and device check (0084), edge side: parsing the Play install
 * referrer, hashing the device ID, and the two write-once ops.
 *
 * The rules (write-once, friend link becomes a referral, one payout per phone)
 * live in SQL and are tested in scripts/tests/installDevice.test.mjs.
 *
 *   npm run test:edge
 */

import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "./lib.ts";
import { deviceHash, opDeviceSeen, opInstallSource, parseReferrer } from "./install.ts";

const ME = "11111111-1111-1111-1111-111111111111";

function fake(rpc: Record<string, (args: Record<string, unknown>) => { data?: unknown; error?: unknown }>) {
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  const admin = {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      const handler = rpc[name];
      return Promise.resolve(handler ? { error: null, ...handler(args) } : { data: null, error: null });
    },
  } as unknown as SupabaseClient;
  return { admin, rpcs, calls: (name: string) => rpcs.filter((r) => r.name === name) };
}

Deno.test("parseReferrer reads utm fields and a friend code", () => {
  assertEquals(parseReferrer("utm_source=invite&utm_medium=friend&friend=k7pxq2"), {
    utmSource: "invite",
    utmMedium: "friend",
    friendCode: "K7PXQ2",
  });
});

Deno.test("parseReferrer drops a friend code outside the alphabet", () => {
  assertEquals(parseReferrer("utm_source=x&friend=K7PXQ0"), { utmSource: "x" });
  assertEquals(parseReferrer("friend=K7PX"), {});
});

Deno.test("parseReferrer handles Play's organic default and junk", () => {
  assertEquals(parseReferrer("utm_source=google-play&utm_medium=organic"), {
    utmSource: "google-play",
    utmMedium: "organic",
  });
  assertEquals(parseReferrer(""), {});
  assertEquals(parseReferrer("%%%"), {});
});

Deno.test("deviceHash is the SHA-256 hex of the salted id", async () => {
  const h = await deviceHash("abc123");
  assertMatch(h, /^[0-9a-f]{64}$/);
  assertEquals(h, await deviceHash("abc123"));
  const expected = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ludo-device:abc123"))),
  ).map((b) => b.toString(16).padStart(2, "0")).join("");
  assertEquals(h, expected);
});

Deno.test("opInstallSource passes the parsed referrer to install_source_record", async () => {
  const f = fake({
    rate_limit_hit: () => ({ data: true }),
    install_source_record: () => ({ data: { recorded: true, referral: { attached: true, inviteeCoins: 100, gamesRequired: 2 } } }),
  });
  const res = await opInstallSource(f.admin, ME, "android", "utm_source=invite&utm_medium=friend&friend=K7PXQ2");
  assertEquals(await res.json(), { recorded: true, referral: { attached: true, inviteeCoins: 100, gamesRequired: 2 } });
  assertEquals(f.calls("install_source_record")[0].args, {
    p_user: ME,
    p_platform: "android",
    p_referrer: "utm_source=invite&utm_medium=friend&friend=K7PXQ2",
    p_utm_source: "invite",
    p_utm_medium: "friend",
    p_utm_campaign: null,
    p_friend_code: "K7PXQ2",
  });
});

Deno.test("opInstallSource refuses a bad platform or an oversized referrer", async () => {
  const f = fake({ rate_limit_hit: () => ({ data: true }) });
  assertEquals((await (await opInstallSource(f.admin, ME, "web", "x")).json()).error !== undefined, true);
  assertEquals((await (await opInstallSource(f.admin, ME, "android", "x".repeat(501))).json()).error !== undefined, true);
  assertEquals(f.calls("install_source_record"), []);
});

Deno.test("opDeviceSeen stores a hash, never the raw id", async () => {
  const f = fake({ rate_limit_hit: () => ({ data: true }), device_record: () => ({ data: true }) });
  const res = await opDeviceSeen(f.admin, ME, "a1b2c3d4e5f60708");
  assertEquals(await res.json(), { ok: true });
  const args = f.calls("device_record")[0].args;
  assertEquals(args.p_user, ME);
  assertEquals(args.p_hash, await deviceHash("a1b2c3d4e5f60708"));
});

Deno.test("opDeviceSeen refuses ids that are too short or too long", async () => {
  const f = fake({ rate_limit_hit: () => ({ data: true }) });
  assertEquals((await (await opDeviceSeen(f.admin, ME, "short")).json()).error !== undefined, true);
  assertEquals((await (await opDeviceSeen(f.admin, ME, "x".repeat(129))).json()).error !== undefined, true);
  assertEquals(f.calls("device_record"), []);
});

Deno.test("both ops stop at the rate limit", async () => {
  const f = fake({ rate_limit_hit: () => ({ data: false }) });
  assertEquals((await (await opInstallSource(f.admin, ME, "android", "")).json()).error !== undefined, true);
  assertEquals((await (await opDeviceSeen(f.admin, ME, "a1b2c3d4e5f60708")).json()).error !== undefined, true);
  assertEquals(f.calls("install_source_record"), []);
  assertEquals(f.calls("device_record"), []);
});
