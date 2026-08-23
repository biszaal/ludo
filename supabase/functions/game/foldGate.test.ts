/**
 * Which clients can be spoken to in the folded protocol.
 *
 * String comparison is the trap here: "1.10.0" < "1.9.0" lexically, so a
 * naive implementation silently switches folding off forever once the app
 * reaches 1.10. Compare numerically, component by component.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { versionAtLeast } from "./lib.ts";

Deno.test("a build at the floor qualifies", () => {
  assertEquals(versionAtLeast("1.1.0", "1.1.0"), true);
});

Deno.test("a build above the floor qualifies", () => {
  assertEquals(versionAtLeast("1.2.0", "1.1.0"), true);
  assertEquals(versionAtLeast("2.0.0", "1.1.0"), true);
});

Deno.test("a build below the floor does not", () => {
  assertEquals(versionAtLeast("1.0.2", "1.1.0"), false);
  assertEquals(versionAtLeast("0.9.0", "1.1.0"), false);
});

Deno.test("double-digit components compare numerically, not as text", () => {
  // The whole reason this function exists rather than a < b.
  assertEquals(versionAtLeast("1.10.0", "1.9.0"), true);
  assertEquals(versionAtLeast("1.9.0", "1.10.0"), false);
});

Deno.test("a pre-handshake client sends nothing and does not qualify", () => {
  assertEquals(versionAtLeast(null, "1.1.0"), false);
});

Deno.test("anything unparseable is treated as unknown, never as current", () => {
  assertEquals(versionAtLeast("", "1.1.0"), false);
  assertEquals(versionAtLeast("banana", "1.1.0"), false);
  assertEquals(versionAtLeast("1.x.0", "1.1.0"), false);
});

Deno.test("a short version string is padded, not rejected", () => {
  assertEquals(versionAtLeast("2", "1.1.0"), true);
  assertEquals(versionAtLeast("1.1", "1.1.0"), true);
});
