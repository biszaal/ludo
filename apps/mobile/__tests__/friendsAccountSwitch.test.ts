/**
 * The friends store across an account switch.
 *
 * Reported as "it is showing my own name on friends" after signing out and back
 * in without closing the app. The store kept the user id it first loaded for,
 * while every later fetch returned the NEW account's rows (RLS scopes them to
 * the session). `acceptedFriendIds` picks "the side that isn't me", so a row the
 * new account had sent resolved to the new account itself.
 *
 * The store is native-importing, so everything it reaches for is stubbed here;
 * what runs is the real store.
 */

import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  signedIn: "A",
  rows: {
    A: [],
    B: [{ id: "f1", requester_user_id: "B", addressee_user_id: "C", status: "accepted", created_at: "" }],
  } as Record<string, unknown[]>,
}));

vi.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
}));
vi.mock("../src/net/api", () => ({
  ensureSignedIn: vi.fn(async () => h.signedIn),
  getMyFriendCode: vi.fn(async () => null),
  getPlayerStats: vi.fn(async () => []),
  getProfiles: vi.fn(async () => []),
  getRecentPlayers: vi.fn(async () => []),
  requestFriend: vi.fn(async () => {}),
}));
vi.mock("../src/net/friends", () => ({
  listFriendships: vi.fn(async () => h.rows[h.signedIn]),
  listMyInvites: vi.fn(async () => []),
  subscribeFriendEvents: vi.fn(() => ({ unsubscribe: vi.fn() })),
}));
vi.mock("../src/store/onlineStore", () => ({ useOnlineStore: { getState: () => ({}) } }));
vi.mock("../src/store/navStore", () => ({ useNav: { getState: () => ({ push: vi.fn() }) } }));
vi.mock("../src/lib/sound", () => ({ playSound: vi.fn() }));

import { useFriends } from "../src/store/friendsStore";
import { acceptedFriendIds } from "../src/lib/friendship";
import { subscribeFriendEvents } from "../src/net/friends";

describe("friends store across an account switch", () => {
  it("reads the new account's rows against the new account", async () => {
    h.signedIn = "A";
    await useFriends.getState().init();
    expect(useFriends.getState().userId).toBe("A");

    // Signed out of A and into B, same app session.
    h.signedIn = "B";
    await useFriends.getState().init();

    const { userId, friendships } = useFriends.getState();
    expect(userId).toBe("B");
    // With the stale "A" this row resolved to ["B"]: the player as their own friend.
    expect(acceptedFriendIds(friendships as never, userId)).toEqual(["C"]);
    // Live events must follow the account too.
    expect(subscribeFriendEvents).toHaveBeenLastCalledWith("B", expect.anything());
  });
});

/**
 * Removing a friend deletes the one row both players share, but Supabase cannot
 * filter Delete events, so the per-user listeners never told the OTHER player.
 * An unfiltered delete listener now does; it hears every friendship delete in
 * the app (ids only) and must act on its own rows alone.
 */
describe("a friendship removed from the other side", () => {
  it("leaves the list as soon as the delete arrives", async () => {
    // Still account B, holding f1, from the test above.
    expect(useFriends.getState().friendships.map((f) => f.id)).toEqual(["f1"]);
    const handlers = vi.mocked(subscribeFriendEvents).mock.lastCall![1];

    handlers.onFriendshipRemoved("someone-elses-row");
    expect(useFriends.getState().friendships.map((f) => f.id)).toEqual(["f1"]);

    handlers.onFriendshipRemoved("f1");
    expect(useFriends.getState().friendships).toEqual([]);
  });
});
