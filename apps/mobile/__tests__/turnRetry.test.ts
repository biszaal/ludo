/**
 * A turn action must survive a dropped request.
 *
 * Roll/move/pass used to be the only calls the client would never re-send —
 * replaying a lost roll could have rolled twice — so on a congested link a
 * request the network threw away was simply gone. The client held the
 * prediction for a few seconds, refetched, and put the board back the way it
 * was: the die spun forever, the pawn walked back, and the player had to act
 * again with a turn clock running.
 *
 * An action id makes a replay something the server can recognise, which is what
 * lets these calls be re-sent at all. These tests pin the client half of that
 * contract: the id is minted once per TAP and reused by every attempt, a
 * verdict is never retried, and a `duplicate` answer is not a state to apply.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

interface Invocation {
  op: string;
  actionId?: string;
}

const invocations: Invocation[] = [];
/** What the next invoke does, one entry per call. */
let script: Array<{ kind: "hang" } | { kind: "fail"; name: string } | { kind: "ok"; body: unknown }> = [];

function fakeSupabase() {
  return {
    functions: {
      invoke(_name: string, opts: { body: Record<string, unknown> }) {
        invocations.push({ op: String(opts.body.op), actionId: opts.body.actionId as string | undefined });
        const step = script.shift() ?? { kind: "ok" as const, body: { state: { id: "s" }, v: 1 } };
        if (step.kind === "hang") return new Promise(() => {}); // never answers
        if (step.kind === "fail") {
          const error = new Error("network") as Error & { name: string };
          error.name = step.name;
          return Promise.resolve({ data: null, error });
        }
        return Promise.resolve({ data: step.body, error: null });
      },
    },
  };
}

vi.mock("../src/lib/supabase", () => ({ getSupabase: () => fakeSupabase() }));
vi.mock("../src/lib/identityClient", () => ({
  getIdentity: () => ({ ensureSignedIn: () => Promise.resolve("u1") }),
}));

import { moveAction, newActionId, rollAction, isTimeout } from "../src/net/api";

beforeEach(() => {
  invocations.length = 0;
  script = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("newActionId", () => {
  it("mints ids that are unique and fit the server's 64-char cap", () => {
    const ids = Array.from({ length: 500 }, () => newActionId());
    expect(new Set(ids).size).toBe(500);
    for (const id of ids) expect(id.length).toBeLessThanOrEqual(64);
  });
});

describe("a dropped turn request", () => {
  it("is re-sent, and every attempt carries the SAME action id", async () => {
    // Two attempts vanish outright — the transport-failure shape, which is what
    // a congested network actually produces.
    script = [
      { kind: "fail", name: "FunctionsFetchError" },
      { kind: "fail", name: "FunctionsRelayError" },
      { kind: "ok", body: { state: { id: "rolled" }, v: 4 } },
    ];

    const id = newActionId();
    const res = await rollAction("g1", id);

    expect(res.state).toEqual({ id: "rolled" });
    expect(invocations.length).toBe(3);
    // One tap, one id. A fresh id per attempt would be a fresh roll per attempt.
    expect(invocations.map((i) => i.actionId)).toEqual([id, id, id]);
  });

  it("gives up after a bounded number of attempts, inside one turn clock", async () => {
    // The true worst case: every attempt goes silent and burns its full budget.
    // This has to fit inside TURN_SECONDS, or the retries hand the turn to the
    // stall bot themselves — trading one way of losing a roll for another.
    vi.useFakeTimers();
    script = Array.from({ length: 8 }, () => ({ kind: "hang" }) as const);

    const started = Date.now();
    let elapsed = -1;
    const call = moveAction("g1", "t1", newActionId()).catch((e) => {
      elapsed = Date.now() - started;
      return e;
    });
    await vi.advanceTimersByTimeAsync(120_000);
    const err = await call;

    expect(isTimeout(err)).toBe(true);
    expect(invocations.length).toBe(4);
    expect(elapsed).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(30_000);
  });

  it("abandons an attempt that goes silent and re-fires it", async () => {
    vi.useFakeTimers();
    script = [{ kind: "hang" }, { kind: "ok", body: { state: { id: "rolled" }, v: 2 } }];

    const call = rollAction("g1", newActionId());
    // Nothing yet — the first attempt is still notionally travelling. This wait
    // is deliberately generous: a congested link routinely takes seconds to
    // answer, and re-firing before then floods the very connection that is
    // already the problem (see TURN_TIMEOUT_MS).
    await vi.advanceTimersByTimeAsync(5_000);
    expect(invocations.length).toBe(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(invocations.length).toBe(2);
    expect((await call).state).toEqual({ id: "rolled" });
  });
});

describe("a verdict from the server", () => {
  it("is never retried — asking again cannot change its mind", async () => {
    script = [{ kind: "ok", body: { error: "Illegal move." } }];

    await expect(moveAction("g1", "t1", newActionId())).rejects.toThrow("Illegal move.");
    expect(invocations.length).toBe(1);
  });
});

describe("a duplicate answer", () => {
  it("is flagged rather than passed off as an ordinary result", async () => {
    script = [{ kind: "ok", body: { state: { id: "old" }, v: 3, duplicate: true } }];

    const res = await rollAction("g1", newActionId());
    // The caller must be able to tell this apart: the row behind it can predate
    // the winning write by milliseconds, so applying it would snap the board
    // back to exactly what the retry existed to prevent.
    expect(res.duplicate).toBe(true);
  });

  it("is absent on an ordinary result", async () => {
    script = [{ kind: "ok", body: { state: { id: "new" }, v: 3 } }];
    expect((await rollAction("g1", newActionId())).duplicate).toBe(false);
  });
});

describe("a call with no action id", () => {
  it("is sent once and carries no id, as older builds did", async () => {
    script = [{ kind: "fail", name: "FunctionsFetchError" }];

    await expect(rollAction("g1")).rejects.toThrow();
    expect(invocations.length).toBe(1);
    expect(invocations[0]!.actionId).toBeUndefined();
  });
});
