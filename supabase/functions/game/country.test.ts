/**
 * Country flags (0083), edge side: the country comes from Cloudflare's
 * cf-ipcountry header, is validated the same way the SQL validates it, and a
 * failure to record it never costs the request it rides on.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "./lib.ts";
import { countryFromHeaders, recordCountry } from "./country.ts";

const ME = "11111111-1111-1111-1111-111111111111";
const headers = (code?: string) => new Headers(code === undefined ? {} : { "cf-ipcountry": code });

function fakeAdmin(error: unknown = null) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const admin = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve({ data: true, error });
    },
  } as unknown as SupabaseClient;
  return { admin, calls };
}

Deno.test("countryFromHeaders accepts a two-letter code in any case", () => {
  assertEquals(countryFromHeaders(headers("NP")), "NP");
  assertEquals(countryFromHeaders(headers("in")), "IN");
});

Deno.test("countryFromHeaders rejects unknown, Tor and malformed values", () => {
  for (const code of ["XX", "T1", "", "USA", "1A"]) assertEquals(countryFromHeaders(headers(code)), null, code);
  assertEquals(countryFromHeaders(headers()), null);
});

Deno.test("recordCountry calls profile_set_country with the code", async () => {
  const { admin, calls } = fakeAdmin();
  await recordCountry(admin, ME, headers("bd"));
  assertEquals(calls, [{ name: "profile_set_country", args: { p_user: ME, p_country: "BD" } }]);
});

Deno.test("recordCountry makes no call without a usable header", async () => {
  const { admin, calls } = fakeAdmin();
  await recordCountry(admin, ME, headers("XX"));
  await recordCountry(admin, ME, headers());
  assertEquals(calls, []);
});

Deno.test("recordCountry never throws", async () => {
  const admin = { rpc: () => Promise.reject(new Error("down")) } as unknown as SupabaseClient;
  await recordCountry(admin, ME, headers("NP"));
});
