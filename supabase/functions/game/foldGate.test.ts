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
import { foldAllowed, FOLD_MIN_VERSION, versionAtLeast } from "./lib.ts";

Deno.test("a build at the floor qualifies", () => {
  assertEquals(versionAtLeast("1.1.0", "1.1.0"), true);
});

Deno.test("a build above the floor qualifies", () => {
  assertEquals(versionAtLeast("1.2.0", "1.1.0"), true);
  assertEquals(versionAtLeast("2.0.0", "1.1.0"), true);
});

Deno.test("a build below the floor does not", () => {
  assertEquals(versionAtLeast("1.0.1", "1.0.2"), false);
  assertEquals(versionAtLeast("0.9.0", "1.0.2"), false);
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

const BOT_A = "bbbbbbbb-0000-0000-0000-000000000001";
const HUMAN_A = "aaaaaaaa-0000-0000-0000-000000000001";
const HUMAN_B = "aaaaaaaa-0000-0000-0000-000000000002";

Deno.test("the floor is the release that adds the broadcast handler", () => {
  // 1.0.2 carries BOTH halves — the appVersion handshake and the broadcast
  // receiver — so it is the first build that can be folded to. Nothing below
  // it reports a version at all.
  assertEquals(FOLD_MIN_VERSION, "1.0.2");
});

Deno.test("a table of updated humans folds", () => {
  const seats = [
    { user_id: HUMAN_A, app_version: "1.0.2" },
    { user_id: HUMAN_B, app_version: "1.1.0" },
  ];
  assertEquals(foldAllowed(seats, new Set<string>()), true);
});

Deno.test("one un-updated seat stops the whole table folding", () => {
  const seats = [
    { user_id: HUMAN_A, app_version: "1.0.2" },
    { user_id: HUMAN_B, app_version: "1.0.1" },
  ];
  assertEquals(foldAllowed(seats, new Set<string>()), false);
});

Deno.test("a pre-handshake seat stops it too", () => {
  const seats = [
    { user_id: HUMAN_A, app_version: "1.0.2" },
    { user_id: HUMAN_B, app_version: null },
  ];
  assertEquals(foldAllowed(seats, new Set<string>()), false);
});

Deno.test("a bot seat never blocks folding, despite having no version", () => {
  // Hidden quick-match bots carry is_bot = false, so game_bots is the only
  // honest source. A bot has no client and renders nothing.
  const seats = [
    { user_id: HUMAN_A, app_version: "1.0.2" },
    { user_id: BOT_A, app_version: null },
  ];
  assertEquals(foldAllowed(seats, new Set([BOT_A])), true);
});

Deno.test("an all-bot table folds", () => {
  const seats = [{ user_id: BOT_A, app_version: null }];
  assertEquals(foldAllowed(seats, new Set([BOT_A])), true);
});

Deno.test("an empty table does not fold", () => {
  // Defensive: no seats means nothing was verified, and the default is no.
  assertEquals(foldAllowed([], new Set<string>()), false);
});
