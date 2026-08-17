/**
 * A row that is gone FOR THIS USER is an answer, not a dropped packet.
 *
 * `games` is row-scoped by RLS (0019), so a player who was reaped out of a
 * waiting room — or was never seated — is simply shown nothing. The old code
 * asked with `.single()`, which turns "not exactly one row" into HTTP 406, and
 * 406 is indistinguishable from a transport failure. withRetry tried 3 times,
 * runResync backed off and rescheduled forever, and one dead game id produced
 * ~100 requests that could never have succeeded.
 *
 * These tests pin the two halves of the fix: the query no longer asks in a way
 * that can 406, and "gone" is not retried.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/** Records every query built against the fake client, so a test can assert on
 *  the SHAPE of the request rather than only on its result. */
interface Recorded {
  table: string;
  single: boolean;
  limit: number | null;
}

const recorded: Recorded[] = [];
/** Rows the next `games` select resolves with. */
let gamesRows: unknown[] = [];
let selectCalls = 0;

function fakeClient() {
  return {
    from(table: string) {
      const entry: Recorded = { table, single: false, limit: null };
      recorded.push(entry);
      const builder: Record<string, unknown> = {
        select() {
          selectCalls++;
          return builder;
        },
        eq() {
          return builder;
        },
        order() {
          return builder;
        },
        limit(n: number) {
          entry.limit = n;
          return Promise.resolve({ data: gamesRows, error: null });
        },
        single() {
          entry.single = true;
          // What PostgREST actually does for 0 rows under the object header.
          return Promise.resolve({
            data: null,
            error: { message: "JSON object requested, multiple (or no) rows returned" },
          });
        },
      };
      return builder;
    },
  };
}

vi.mock("../src/lib/supabase", () => ({ getSupabase: () => fakeClient() }));
// api.ts pulls in identityClient, which pulls in expo-secure-store — native,
// Flow-typed, and unparseable in the Node test environment. Nothing here calls
// it, so a stub is enough to keep the module graph loadable.
vi.mock("../src/lib/identityClient", () => ({ getIdentity: vi.fn() }));

// vi.mock is hoisted above this, so api picks up the fake client.
import * as api from "../src/net/api";

beforeEach(() => {
  recorded.length = 0;
  selectCalls = 0;
  gamesRows = [];
});

describe("fetchGame", () => {
  it("does not use .single(), so an invisible row cannot come back as a 406", async () => {
    gamesRows = [];
    await expect(api.fetchGame("dead-game")).rejects.toBeInstanceOf(api.RowGoneError);
    expect(recorded.every((r) => !r.single)).toBe(true);
    expect(recorded[0]?.limit).toBe(1);
  });

  it("does not retry a row that is gone — one request, not three", async () => {
    gamesRows = [];
    await expect(api.fetchGame("dead-game")).rejects.toBeInstanceOf(api.RowGoneError);
    // This is the whole point: withRetry must not multiply a settled answer.
    expect(selectCalls).toBe(1);
  });

  it("carries a message fit to show a player", async () => {
    gamesRows = [];
    await expect(api.fetchGame("dead-game")).rejects.toThrow(/no longer available/i);
  });

  it("returns the row when one is visible", async () => {
    gamesRows = [{ id: "g1", status: "active", state: null, state_version: 3 }];
    const row = await api.fetchGame("g1");
    expect(row.id).toBe("g1");
    expect(selectCalls).toBe(1);
  });
});

describe("RowGoneError", () => {
  it("is distinguishable from an ordinary failure", () => {
    expect(new api.RowGoneError("game")).toBeInstanceOf(Error);
    expect(new Error("network")).not.toBeInstanceOf(api.RowGoneError);
  });
});
