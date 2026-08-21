/**
 * Deno tests for who gets told a friend came online.
 *
 * These caps are the feature. Delivery is the easy half — sendPush already
 * works, and 0029 proved it — while the hard half is not burning the
 * notification permission, which is shared with room invites. An invite is the
 * thing players actually asked for; if "Maya is online" trains them to swipe
 * the app's notifications away, it takes invites down with it.
 *
 * So the numbers below are pinned deliberately, and each test says what would
 * go wrong without its rule.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { onlineNotifyTargets } from "./social.ts";

const NOW = Date.parse("2026-08-20T18:00:00Z");
const HOUR = 3600_000;

/** All filters open; each test closes exactly the one it is about. */
function opts(over: Partial<Parameters<typeof onlineNotifyTargets>[0]> = {}) {
  return {
    friendIds: ["a", "b", "c"],
    botIds: new Set<string>(),
    inApp: new Set<string>(),
    blocked: new Set<string>(),
    lastToldAt: new Map<string, number>(),
    todayCount: new Map<string, number>(),
    now: NOW,
    ...over,
  };
}

Deno.test("tells every eligible friend", () => {
  assertEquals(onlineNotifyTargets(opts()), ["a", "b", "c"]);
});

Deno.test("says nothing when there are no friends", () => {
  assertEquals(onlineNotifyTargets(opts({ friendIds: [] })), []);
});

Deno.test("never notifies a hidden bot seat", () => {
  // Nobody is there. The push would be pure outbound traffic, and traffic aimed
  // at bot accounts is exactly the pattern that gives them away.
  assertEquals(onlineNotifyTargets(opts({ botIds: new Set(["b"]) })), ["a", "c"]);
});

Deno.test("skips friends who already have the app open", () => {
  // Their Friends screen shows the presence dot go green in real time (0017).
  // A push on top of that is the app telling someone what they can already see.
  assertEquals(onlineNotifyTargets(opts({ inApp: new Set(["a", "c"]) })), ["b"]);
});

Deno.test("skips a block in either direction", () => {
  assertEquals(onlineNotifyTargets(opts({ blocked: new Set(["a"]) })), ["b", "c"]);
});

Deno.test("holds the pair cooldown, so one evening is one notification", () => {
  // Backgrounding and reopening all evening must not be worth a notification
  // each time. Anything inside the window is silent; older than it is news.
  const lastToldAt = new Map([
    ["a", NOW - 1 * HOUR], // just told them
    ["b", NOW - 7 * HOUR], // still inside the 8h window
    ["c", NOW - 9 * HOUR], // long enough ago to say again
  ]);
  assertEquals(onlineNotifyTargets(opts({ lastToldAt })), ["c"]);
});

Deno.test("a friend never told before is always eligible", () => {
  // Guards the cooldown's missing-entry default: read as 0 rather than "never",
  // a first-ever notification would be compared against the epoch and pass —
  // which is right — but read as `now` it would never fire at all.
  assertEquals(onlineNotifyTargets(opts({ friendIds: ["z"] })), ["z"]);
});

Deno.test("respects a recipient's daily cap however many friends log on", () => {
  // The pair cooldown does nothing for someone with forty friends: forty
  // different people, each inside their own cooldown, still add up to forty
  // notifications. This is the cap that actually bounds a recipient's day.
  const todayCount = new Map([
    ["a", 3], // at the cap
    ["b", 4], // over it (a cap that was lowered, or a race)
    ["c", 2],
  ]);
  assertEquals(onlineNotifyTargets(opts({ todayCount })), ["c"]);
});

Deno.test("caps the fan-out from one launch", () => {
  const friendIds = Array.from({ length: 40 }, (_, i) => `f${i}`);
  const picked = onlineNotifyTargets(opts({ friendIds }));
  assertEquals(picked.length, 10);
  assertEquals(picked[0], "f0");
});

Deno.test("the fan-out cap counts only friends it actually picked", () => {
  // The cap must apply AFTER the exclusions, not before: 30 skippable friends
  // ahead of 10 eligible ones must not eat the whole allowance and deliver
  // nothing.
  const friendIds = [...Array.from({ length: 30 }, (_, i) => `skip${i}`), "real0", "real1"];
  const inApp = new Set(friendIds.filter((f) => f.startsWith("skip")));
  assertEquals(onlineNotifyTargets(opts({ friendIds, inApp })), ["real0", "real1"]);
});

Deno.test("one blocked-off rule is enough to stay silent", () => {
  const picked = onlineNotifyTargets(
    opts({
      friendIds: ["a"],
      inApp: new Set(["a"]),
      todayCount: new Map([["a", 0]]),
    }),
  );
  assertEquals(picked, []);
});
