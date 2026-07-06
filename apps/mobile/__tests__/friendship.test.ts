/**
 * Pure relationship logic (src/lib/friendship). The realtime/table layer is
 * exercised on-device; these tests pin the directed-row interpretation that
 * drives the "Add friend / Requested / Accept / Friends" affordances.
 */

import { describe, expect, it } from "vitest";
import {
  acceptedFriendIds,
  incomingRequests,
  relationshipTo,
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
