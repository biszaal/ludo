/**
 * A game call made after the account changes does not name the old game.
 *
 * The retry ladder and the game-row reads keep the id they were given. The
 * auth listener releases that id; the next attempt has to notice and stop
 * before it touches the network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

interface Invocation {
  op: string;
  gameId?: string;
}

const invocations: Invocation[] = [];
const queries: string[] = [];
let script: Array<{ kind: "fail"; name: string } | { kind: "ok"; body: unknown }> = [];
let gamesFail = false;

function fakeSupabase() {
  return {
    functions: {
      invoke(_name: string, opts: { body: Record<string, unknown> }) {
        invocations.push({
          op: String(opts.body.op),
          gameId: typeof opts.body.gameId === "string" ? opts.body.gameId : undefined,
        });
        const step = script.shift() ?? { kind: "ok" as const, body: { state: { gameId: "g-new" }, v: 2 } };
        if (step.kind === "fail") {
          const error = new Error("network") as Error & { name: string };
          error.name = step.name;
          return Promise.resolve({ data: null, error });
        }
        return Promise.resolve({ data: step.body, error: null });
      },
    },
    from(table: string) {
      queries.push(table);
      const run = () => {
        if (gamesFail) return Promise.reject(new Error("network"));
        return Promise.resolve({
          data: [{ id: "g-new", status: "active", state: null, state_version: 1 }],
          error: null,
        });
      };
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self;
      chain.update = self;
      chain.order = self;
      chain.eq = self;
      chain.limit = () => run();
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        run().then(resolve, reject);
      return chain;
    },
  };
}

vi.mock("../src/lib/supabase", () => ({ getSupabase: () => fakeSupabase() }));
vi.mock("../src/lib/identityClient", () => ({
  getIdentity: () => ({ ensureSignedIn: () => Promise.resolve("u2") }),
}));

import { fetchGame, newActionId, rollAction, setConnected } from "../src/net/api";
import { GameReleasedError, OnlineAccount } from "../src/lib/onlineAccount";

beforeEach(() => {
  invocations.length = 0;
  queries.length = 0;
  script = [];
  gamesFail = false;
  OnlineAccount.testingOnlyReset();
  OnlineAccount.note("user-a");
  OnlineAccount.hold("g-old");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a game call after an identity switch", () => {
  it("does not send the retry, and a later call names the new game", async () => {
    vi.useFakeTimers();
    script = [
      { kind: "fail", name: "FunctionsFetchError" },
      { kind: "ok", body: { state: { gameId: "g-old" }, v: 2 } },
    ];

    const pending = rollAction("g-old", newActionId());
    // Attached before the rejection, so the ladder's failure is not an
    // unhandled rejection sitting between the two awaits.
    const rejected = expect(pending).rejects.toBeInstanceOf(GameReleasedError);
    await vi.advanceTimersByTimeAsync(0);
    expect(invocations.map((call) => call.gameId)).toEqual(["g-old"]);

    // The account changed while the ladder was waiting to try again.
    OnlineAccount.note("user-b");
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(invocations.map((call) => call.gameId)).toEqual(["g-old"]);

    OnlineAccount.hold("g-new");
    script = [{ kind: "ok", body: { state: { gameId: "g-new" }, v: 3 } }];
    await rollAction("g-new", newActionId());
    await expect(rollAction("g-old", newActionId())).rejects.toBeInstanceOf(GameReleasedError);

    expect(invocations.map((call) => call.gameId)).toEqual(["g-old", "g-new"]);
  });

  it("does not read or touch presence for the old game", async () => {
    OnlineAccount.note("user-b");

    await expect(fetchGame("g-old")).rejects.toBeInstanceOf(GameReleasedError);
    await setConnected("g-old", "user-a", true);
    expect(queries).toEqual([]);

    OnlineAccount.hold("g-new");
    const row = await fetchGame("g-new");
    expect(row.id).toBe("g-new");
    expect(queries).toEqual(["games"]);
  });

  it("does not retry a read that was in flight when the account changed", async () => {
    vi.useFakeTimers();
    gamesFail = true;
    const pending = fetchGame("g-old");
    const rejected = expect(pending).rejects.toBeInstanceOf(GameReleasedError);
    await vi.advanceTimersByTimeAsync(0);
    expect(queries).toEqual(["games"]);

    OnlineAccount.note("user-b");
    gamesFail = false;
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(queries).toEqual(["games"]);
  });
});
