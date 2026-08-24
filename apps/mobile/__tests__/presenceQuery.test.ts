/**
 * The presence poll must ask for its friends by name.
 *
 * `getPresence` used to select `user_presence` unfiltered and lean on RLS to
 * trim the result to accepted friends (0017). That is correct but quadratic:
 * the policy runs an EXISTS against `friendships` for EVERY row in the table,
 * so one poll costs O(registered users) index lookups, and every client repeats
 * it on a 30s timer. At 309 users and 11 friendships the overwhelmingly common
 * case is a client with no friends at all paying a full scan to be told so.
 *
 * These tests pin the shape of the request, not just its result: the ids go
 * into the query, and a caller with nobody to ask for doesn't ask.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/** Records the shape of each query built against the fake client. */
interface Recorded {
  table: string;
  /** Column + values passed to `.in()`, or null when the query didn't filter. */
  filtered: { column: string; values: string[] } | null;
}

const recorded: Recorded[] = [];
/** Rows the next `user_presence` select resolves with. */
let presenceRows: unknown[] = [];

function fakeClient() {
  return {
    from(table: string) {
      const entry: Recorded = { table, filtered: null };
      recorded.push(entry);
      const builder: Record<string, unknown> = {
        select() {
          return builder;
        },
        in(column: string, values: string[]) {
          entry.filtered = { column, values };
          return Promise.resolve({ data: presenceRows, error: null });
        },
        then(resolve: (r: unknown) => void) {
          // An unfiltered select is awaited directly — keep it working so the
          // test fails on the ASSERTION about filtering, not on a hang.
          return Promise.resolve({ data: presenceRows, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
}

vi.mock("../src/lib/supabase", () => ({ getSupabase: () => fakeClient() }));
// friends.ts imports api.ts, which pulls in expo-secure-store via
// identityClient — native and unparseable under Node. Nothing here calls it.
vi.mock("../src/lib/identityClient", () => ({ getIdentity: vi.fn() }));
vi.mock("../src/net/api", () => ({
  announceOnlineOp: vi.fn(),
  ensureSignedIn: vi.fn().mockResolvedValue("me"),
  inviteToRoomOp: vi.fn(),
}));

import { getPresence } from "../src/net/friends";

beforeEach(() => {
  recorded.length = 0;
  presenceRows = [];
});

describe("getPresence", () => {
  it("asks only for the given friend ids", async () => {
    presenceRows = [{ user_id: "a", last_seen_at: "2026-08-23T12:00:00Z", status: "online" }];

    await getPresence(["a", "b"]);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.table).toBe("user_presence");
    expect(recorded[0]?.filtered).toEqual({ column: "user_id", values: ["a", "b"] });
  });

  it("does not query at all when the caller has no friends", async () => {
    await getPresence([]);

    expect(recorded).toHaveLength(0);
  });

  it("returns an empty map when the caller has no friends", async () => {
    expect(await getPresence([])).toEqual({});
  });

  it("still collapses an explicit offline status to 0", async () => {
    presenceRows = [
      { user_id: "a", last_seen_at: "2026-08-23T12:00:00Z", status: "online" },
      { user_id: "b", last_seen_at: "2026-08-23T12:00:00Z", status: "offline" },
    ];

    const presence = await getPresence(["a", "b"]);

    expect(presence.a).toBe(Date.parse("2026-08-23T12:00:00Z"));
    expect(presence.b).toBe(0);
  });
});
