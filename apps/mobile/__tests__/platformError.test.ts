/**
 * A gateway failure is not the server's answer.
 *
 * functions-js sorts failures into three names, and api.unanswered() reads two
 * of them as "no answer arrived". The third, FunctionsHttpError, was documented
 * as "the function RAN and returned non-2xx — a real answer", and for a 4xx
 * that is exactly right: the router answers `{ error }` with a 200, so a 4xx
 * can only come from the platform rejecting the request outright.
 *
 * But a 5xx carries the same name and means the opposite. Supabase's edge
 * runtime returns 502 when it cannot CREATE a worker: the request is refused in
 * single-digit milliseconds, no worker boots, and the function never runs. The
 * project's own logs show these arriving in bursts of eight, clustered in
 * low-traffic hours where no worker is warm, with an HTML body — so `ctx.json()`
 * throws, the default supabase-js string survives, and the player is shown
 * "Edge Function returned a non-2xx status code" as though the server had
 * considered their request and declined it.
 *
 * Nothing was retried, because a verdict is not worth asking twice. These tests
 * pin the correction: transient platform failures (5xx, and 429 for a rate
 * limit that will pass) are unanswered, so the turn ladder re-fires them and
 * quick match gets a ladder of its own. A 4xx stays a verdict.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

interface Invocation {
  op: string;
  actionId?: string;
}

const invocations: Invocation[] = [];
type Step =
  | { kind: "hang" }
  | { kind: "fail"; name: string }
  | { kind: "http"; status: number; body?: unknown }
  | { kind: "ok"; body: unknown };
let script: Step[] = [];

/**
 * A FunctionsHttpError as functions-js actually builds it: the name, and a
 * `context` that is the Response itself — which is where the status lives and
 * why reading it is possible at all. The HTML case models the real 502: a body
 * that is not JSON, so `json()` rejects.
 */
function httpError(status: number, body?: unknown) {
  const error = new Error("Edge Function returned a non-2xx status code") as Error & {
    name: string;
    context: { status: number; json: () => Promise<unknown> };
  };
  error.name = "FunctionsHttpError";
  error.context = {
    status,
    json: () => (body === undefined ? Promise.reject(new SyntaxError("Unexpected token <")) : Promise.resolve(body)),
  };
  return error;
}

function fakeSupabase() {
  return {
    functions: {
      invoke(_name: string, opts: { body: Record<string, unknown> }) {
        invocations.push({ op: String(opts.body.op), actionId: opts.body.actionId as string | undefined });
        const step = script.shift() ?? { kind: "ok" as const, body: { state: { id: "s" }, v: 1 } };
        if (step.kind === "hang") return new Promise(() => {});
        if (step.kind === "fail") {
          const error = new Error("network") as Error & { name: string };
          error.name = step.name;
          return Promise.resolve({ data: null, error });
        }
        if (step.kind === "http") {
          return Promise.resolve({ data: null, error: httpError(step.status, step.body) });
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

import { isTimeout, newActionId, quickMatch, rollAction, setLinkMonitor } from "../src/net/api";

beforeEach(() => {
  invocations.length = 0;
  script = [];
  setLinkMonitor(null);
});

/** A ladder-exhausting run of one status, so what surfaces is the classification
 *  and not a retry that happened to land on the default success step. */
const allFailing = (status: number): Step[] =>
  Array.from({ length: 6 }, () => ({ kind: "http" as const, status }));

describe("a platform failure is not a verdict", () => {
  it("treats a 502 as unanswered, not as the server speaking", async () => {
    script = allFailing(502);
    await expect(quickMatch(4, 100)).rejects.toSatisfy(isTimeout);
  });

  it("treats 500, 503 and 504 the same way", async () => {
    for (const status of [500, 503, 504]) {
      script = allFailing(status);
      invocations.length = 0;
      await expect(quickMatch(4, 100)).rejects.toSatisfy(isTimeout);
    }
  });

  it("treats 429 as unanswered — a rate limit passes, a verdict does not", async () => {
    script = allFailing(429);
    await expect(quickMatch(4, 100)).rejects.toSatisfy(isTimeout);
  });

  it("blames the server, not the player's connection", async () => {
    script = allFailing(502);
    // The default TimeoutError text sends someone to check their wifi over a
    // fault on somebody else's machine. Neither string may leak supabase-js's.
    await expect(quickMatch(4, 100)).rejects.toThrow(/server is busy/i);
    script = allFailing(502);
    await expect(quickMatch(4, 100)).rejects.not.toThrow(/connection|non-2xx/i);
  });

  it("still treats a 4xx as a verdict, with the server's own message", async () => {
    script = [{ kind: "http", status: 400, body: { error: "Not enough coins." } }];
    await expect(quickMatch(4, 100)).rejects.toThrow("Not enough coins.");
    script = [{ kind: "http", status: 403, body: { error: "Nope." } }];
    await expect(quickMatch(4, 100)).rejects.not.toSatisfy(isTimeout);
  });
});

describe("quick match survives a 502 burst", () => {
  it("re-fires and succeeds once a worker is finally there", async () => {
    script = [
      { kind: "http", status: 502 },
      { kind: "http", status: 502 },
      { kind: "ok", body: { gameId: "g1", playerId: "p1", waiting: true, size: 4, stake: 100 } },
    ];
    const res = await quickMatch(4, 100);
    expect(res.gameId).toBe("g1");
    expect(invocations).toHaveLength(3);
    expect(invocations.every((i) => i.op === "quickMatch")).toBe(true);
  });

  it("gives up rather than hammering a gateway that stays down", async () => {
    script = Array.from({ length: 12 }, () => ({ kind: "http" as const, status: 502 }));
    await expect(quickMatch(4, 100)).rejects.toSatisfy(isTimeout);
    expect(invocations.length).toBeLessThanOrEqual(4);
  });

  it("does not retry a verdict — one 'not enough coins' is asked once", async () => {
    script = [{ kind: "http", status: 400, body: { error: "Not enough coins." } }];
    await expect(quickMatch(4, 100)).rejects.toThrow("Not enough coins.");
    expect(invocations).toHaveLength(1);
  });
});

describe("turn ops ride the existing ladder through a 502", () => {
  it("re-fires a roll on 502 and reuses the one action id", async () => {
    script = [
      { kind: "http", status: 502 },
      { kind: "ok", body: { state: { id: "s" }, v: 2 } },
    ];
    const id = newActionId();
    const res = await rollAction("g1", id);
    expect(res.v).toBe(2);
    expect(invocations).toHaveLength(2);
    expect(invocations[0]!.actionId).toBe(id);
    expect(invocations[1]!.actionId).toBe(id);
  });
});
