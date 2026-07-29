/**
 * Pure relationship logic (src/lib/friendship). The realtime/table layer is
 * exercised on-device; these tests pin the directed-row interpretation that
 * drives the "Add friend / Requested / Accept / Friends" affordances.
 */

import { describe, expect, it } from "vitest";
import {
  acceptedFriendIds,
  formatRecord,
  incomingRequests,
  isOnline,
  onlineFriendCount,
  outgoingRequests,
  PRESENCE_TTL_MS,
  relationshipTo,
  sortFriendsByPresence,
  type FriendshipRow,
} from "../src/lib/friendship";

const row = (over: Partial<FriendshipRow>): FriendshipRow => ({
  id: "r",
  requester_user_id: "a",
  addressee_user_id: "b",
  status: "pending",
  ...over,
});

describe("relationshipTo", () => {
  it("is none for a stranger, self, or missing me", () => {
    expect(relationshipTo([], "me", "x").kind).toBe("none");
    expect(relationshipTo([], "me", "me").kind).toBe("none");
    expect(relationshipTo([row({})], null, "b").kind).toBe("none");
  });

  it("reads a request I sent as outgoing, one I received as incoming", () => {
    const sent = row({ id: "s", requester_user_id: "me", addressee_user_id: "them" });
    const got = row({ id: "g", requester_user_id: "them", addressee_user_id: "me" });
    expect(relationshipTo([sent], "me", "them")).toEqual({ kind: "outgoing", id: "s" });
    expect(relationshipTo([got], "me", "them")).toEqual({ kind: "incoming", id: "g" });
  });

  it("reads an accepted row as friends regardless of direction", () => {
    const accepted = row({ id: "f", requester_user_id: "them", addressee_user_id: "me", status: "accepted" });
    expect(relationshipTo([accepted], "me", "them")).toEqual({ kind: "friends", id: "f" });
  });
});

describe("acceptedFriendIds", () => {
  it("returns the other party of each accepted row", () => {
    const rows = [
      row({ id: "1", requester_user_id: "me", addressee_user_id: "x", status: "accepted" }),
      row({ id: "2", requester_user_id: "y", addressee_user_id: "me", status: "accepted" }),
      row({ id: "3", requester_user_id: "me", addressee_user_id: "z", status: "pending" }),
    ];
    expect(acceptedFriendIds(rows, "me").sort()).toEqual(["x", "y"]);
  });
});

describe("incomingRequests", () => {
  it("returns only pending rows addressed to me", () => {
    const rows = [
      row({ id: "in", requester_user_id: "x", addressee_user_id: "me" }),
      row({ id: "out", requester_user_id: "me", addressee_user_id: "y" }),
      row({ id: "acc", requester_user_id: "z", addressee_user_id: "me", status: "accepted" }),
    ];
    expect(incomingRequests(rows, "me").map((r) => r.id)).toEqual(["in"]);
  });
});

describe("outgoingRequests", () => {
  it("returns only pending rows I sent — the cancellable ones", () => {
    const rows = [
      row({ id: "in", requester_user_id: "x", addressee_user_id: "me" }),
      row({ id: "out", requester_user_id: "me", addressee_user_id: "y" }),
      row({ id: "acc", requester_user_id: "me", addressee_user_id: "z", status: "accepted" }),
    ];
    expect(outgoingRequests(rows, "me").map((r) => r.id)).toEqual(["out"]);
    expect(outgoingRequests(rows, null)).toEqual([]);
  });
});

describe("isOnline", () => {
  const now = 1_000_000;

  it("is false when we've never seen them", () => {
    expect(isOnline(null, now)).toBe(false);
    expect(isOnline(undefined, now)).toBe(false);
    expect(isOnline(0, now)).toBe(false);
  });

  it("tolerates one missed heartbeat but not a stale one", () => {
    expect(isOnline(now - 61_000, now)).toBe(true); // one beat missed
    expect(isOnline(now - PRESENCE_TTL_MS - 1, now)).toBe(false);
  });
});

describe("sortFriendsByPresence", () => {
  it("puts online friends first, then most-recently-seen", () => {
    const now = 1_000_000;
    const presence = {
      stale: now - 10 * 60_000,
      onOld: now - 80_000,
      onNew: now - 1_000,
      never: 0,
    };
    expect(sortFriendsByPresence(["stale", "never", "onOld", "onNew"], presence, now)).toEqual([
      "onNew",
      "onOld",
      "stale",
      "never",
    ]);
  });

  it("does not mutate the input", () => {
    const ids = ["b", "a"];
    sortFriendsByPresence(ids, {}, 0);
    expect(ids).toEqual(["b", "a"]);
  });
});

describe("onlineFriendCount", () => {
  const now = 1_000_000;
  const rows = [
    row({ id: "1", requester_user_id: "me", addressee_user_id: "on", status: "accepted" }),
    row({ id: "2", requester_user_id: "off", addressee_user_id: "me", status: "accepted" }),
    row({ id: "3", requester_user_id: "pend", addressee_user_id: "me", status: "pending" }),
  ];

  it("counts only accepted friends with a live heartbeat", () => {
    const presence = { on: now - 1_000, off: now - PRESENCE_TTL_MS - 1, pend: now };
    expect(onlineFriendCount(rows, "me", presence, now)).toBe(1);
  });

  it("is zero with no presence data, no rows, or no signed-in user", () => {
    expect(onlineFriendCount(rows, "me", {}, now)).toBe(0);
    expect(onlineFriendCount([], "me", { on: now }, now)).toBe(0);
    expect(onlineFriendCount(rows, null, { on: now }, now)).toBe(0);
  });

  it("does not count a pending requester who happens to be online", () => {
    expect(onlineFriendCount(rows, "me", { pend: now }, now)).toBe(0);
  });
});

describe("formatRecord", () => {
  it("hides the record until there's enough of one to show", () => {
    expect(formatRecord(4, 4)).toBeNull();
    expect(formatRecord(0, 0)).toBeNull();
  });

  it("states played and won — never a loss count", () => {
    expect(formatRecord(31, 12)).toBe("31 played · 12 wins");
    expect(formatRecord(5, 1)).toBe("5 played · 1 win");
  });
});
