/**
 * Deno tests for the guest reaper.
 *
 * This is the only op in the codebase whose bugs are unrecoverable: a game can
 * be re-dealt and a coin can be re-granted, but a deleted auth user is gone with
 * its wallet, its cosmetics and its name. So these tests are not about the happy
 * path — they pin the four ways this could delete the wrong person, and each one
 * says what it is standing in front of.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { opSweepGuests } from "./sweep.ts";
import type { SupabaseClient } from "./lib.ts";

const SECRET = "correct-horse-battery-staple";

function uid(n: number): string {
  return `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
}

interface Recorded {
  deleted: string[];
  purged: string[][];
  runs: Array<Record<string, number>>;
  attemptBumps: Array<{ user: string; attempts: number }>;
}

interface StubOpts {
  /** Marks the queue hands back, oldest first. */
  marks?: string[];
  /** Ids guest_sweep_confirm re-confirms. Defaults to every mark. */
  confirms?: string[];
  /** Ids whose deleteUser rejects. */
  failDeletes?: Set<string>;
  /** Make guest_sweep_confirm itself fail. */
  confirmError?: boolean;
  /** internal_config values. */
  config?: Record<string, string>;
  /** Existing attempts per mark. */
  attempts?: Record<string, number>;
}

function stub(opts: StubOpts = {}): { admin: SupabaseClient; rec: Recorded } {
  const marks = opts.marks ?? [];
  const confirms = opts.confirms ?? marks;
  const failDeletes = opts.failDeletes ?? new Set<string>();
  const config = opts.config ?? {};
  const attempts = opts.attempts ?? {};

  const rec: Recorded = { deleted: [], purged: [], runs: [], attemptBumps: [] };

  // Chainable query builder: every filter returns itself, and the terminal is
  // whatever the table is supposed to yield.
  function builder(table: string, limitRef: { value: number }) {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "lt", "order", "update", "insert"]) {
      chain[m] = (arg?: unknown, val?: unknown) => {
        if (m === "insert" && table === "guest_sweep_runs") {
          rec.runs.push(arg as Record<string, number>);
          return Promise.resolve({ data: null, error: null });
        }
        if (m === "update" && table === "guest_sweep_marks") {
          const patch = arg as { attempts: number };
          // .eq("user_id", id) lands next; capture it there.
          chain.__pendingAttempts = patch.attempts;
        }
        if (m === "eq" && table === "guest_sweep_marks" && chain.__pendingAttempts !== undefined) {
          rec.attemptBumps.push({ user: String(val), attempts: chain.__pendingAttempts as number });
          chain.__pendingAttempts = undefined;
          return Promise.resolve({ data: null, error: null });
        }
        return chain;
      };
    }
    chain.limit = (n: number) => {
      limitRef.value = n;
      return Promise.resolve({
        data: marks.slice(0, n).map((id) => ({ user_id: id })),
        error: null,
      });
    };
    chain.maybeSingle = () => {
      if (table === "internal_config") {
        return Promise.resolve({ data: chain.__key ? { value: config[chain.__key as string] } : null, error: null });
      }
      return Promise.resolve({ data: { attempts: attempts[chain.__lookupUser as string] ?? 0 }, error: null });
    };
    return chain;
  }

  const limitRef = { value: 0 };

  const admin = {
    from(table: string) {
      const b = builder(table, limitRef) as Record<string, unknown>;
      // internal_config and the attempts read both key off .eq(); remember it.
      const origEq = b.eq as (a?: unknown, v?: unknown) => unknown;
      b.eq = (col?: unknown, val?: unknown) => {
        if (table === "internal_config" && col === "key") b.__key = val;
        if (table === "guest_sweep_marks" && col === "user_id") b.__lookupUser = val;
        return origEq(col, val);
      };
      return b;
    },
    rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "guest_sweep_confirm") {
        if (opts.confirmError) return Promise.resolve({ data: null, error: { message: "boom" } });
        const asked = args.p_users as string[];
        return Promise.resolve({
          data: asked.filter((id) => confirms.includes(id)).map((user_id) => ({ user_id })),
          error: null,
        });
      }
      if (fn === "guest_sweep_purge") {
        rec.purged.push([...(args.p_users as string[])]);
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    auth: {
      admin: {
        deleteUser(id: string) {
          if (failDeletes.has(id)) return Promise.resolve({ data: null, error: { message: "rate limited" } });
          rec.deleted.push(id);
          return Promise.resolve({ data: {}, error: null });
        },
      },
    },
  } as unknown as SupabaseClient;

  return { admin, rec };
}

function request(secret: string | null): Request {
  return new Request("https://example.test/game", {
    method: "POST",
    headers: secret === null ? {} : { "x-sweep-secret": secret },
    body: JSON.stringify({ op: "sweepGuests" }),
  });
}

const body = async (res: Response) =>
  (await res.json()) as { ok?: boolean; error?: string; considered?: number; confirmed?: number; deleted?: number; failed?: number };

function withSecret(value: string | undefined, run: () => Promise<void>): Promise<void> {
  const prev = Deno.env.get("SWEEP_SECRET");
  if (value === undefined) Deno.env.delete("SWEEP_SECRET");
  else Deno.env.set("SWEEP_SECRET", value);
  return run().finally(() => {
    if (prev === undefined) Deno.env.delete("SWEEP_SECRET");
    else Deno.env.set("SWEEP_SECRET", prev);
  });
}

// --- authentication ----------------------------------------------------------

Deno.test("a wrong secret deletes nobody", async () => {
  await withSecret(SECRET, async () => {
    const { admin, rec } = stub({ marks: [uid(1), uid(2)] });
    const res = await opSweepGuests(admin, request("wrong"));
    assertEquals((await body(res)).error, "Not authenticated.");
    // The assertion that matters is not the message, it is this.
    assertEquals(rec.deleted, []);
  });
});

Deno.test("an unset SWEEP_SECRET fails closed", async () => {
  // The fail-OPEN shape is `secretMatches("", "")`, which is true. If this ever
  // regresses, an unconfigured environment turns account deletion into an
  // unauthenticated endpoint over the whole guest userbase.
  await withSecret(undefined, async () => {
    const { admin, rec } = stub({ marks: [uid(1)] });
    const res = await opSweepGuests(admin, request(null));
    assertEquals((await body(res)).error, "Not authenticated.");
    assertEquals(rec.deleted, []);
  });
});

// --- the confirm gate --------------------------------------------------------

Deno.test("only a confirmed candidate is deleted", async () => {
  // THE test. A mark is written by cron and acted on a week later; in between
  // the player may have come back, paid, or saved an account. uid(2) is that
  // player: still marked, no longer a candidate. Deleting them is the incident.
  await withSecret(SECRET, async () => {
    const { admin, rec } = stub({
      marks: [uid(1), uid(2), uid(3)],
      confirms: [uid(1), uid(3)],
    });
    const res = await opSweepGuests(admin, request(SECRET));
    assertEquals(rec.deleted.sort(), [uid(1), uid(3)]);
    assertEquals((await body(res)).confirmed, 2);
  });
});

Deno.test("a failed confirm deletes nobody rather than trusting the marks", async () => {
  // If we cannot prove anyone is still a candidate, the safe answer is to do
  // nothing and try tomorrow — never to fall back to the unconfirmed list.
  await withSecret(SECRET, async () => {
    const { admin, rec } = stub({ marks: [uid(1), uid(2)], confirmError: true });
    const res = await opSweepGuests(admin, request(SECRET));
    assertEquals((await body(res)).error, "Sweep aborted.");
    assertEquals(rec.deleted, []);
  });
});

// --- batching and failure isolation ------------------------------------------

Deno.test("the batch is capped", async () => {
  await withSecret(SECRET, async () => {
    const many = Array.from({ length: 500 }, (_, i) => uid(i + 1));
    const { admin, rec } = stub({ marks: many, config: { sweep_max_per_run: "50" } });
    await opSweepGuests(admin, request(SECRET));
    assertEquals(rec.deleted.length, 50);
  });
});

Deno.test("one failure does not abort the batch", async () => {
  // A rate limit on one account must not strand every account behind it.
  await withSecret(SECRET, async () => {
    const { admin, rec } = stub({
      marks: [uid(1), uid(2), uid(3)],
      failDeletes: new Set([uid(2)]),
    });
    const res = await opSweepGuests(admin, request(SECRET));
    assertEquals(rec.deleted.sort(), [uid(1), uid(3)]);
    assertEquals((await body(res)).failed, 1);
  });
});

Deno.test("a failure bumps that mark's attempt counter", async () => {
  await withSecret(SECRET, async () => {
    const { admin, rec } = stub({
      marks: [uid(1)],
      failDeletes: new Set([uid(1)]),
      attempts: { [uid(1)]: 2 },
    });
    await opSweepGuests(admin, request(SECRET));
    assertEquals(rec.attemptBumps, [{ user: uid(1), attempts: 3 }]);
  });
});

// --- the purge ---------------------------------------------------------------

Deno.test("only confirmed-and-deleted ids reach the purge", async () => {
  // guest_sweep_purge deletes seats, hosted games and the coin ledger with no
  // foreign key to protect them. Handing it a user who still exists is the one
  // failure here that damages a LIVE account.
  await withSecret(SECRET, async () => {
    const { admin, rec } = stub({
      marks: [uid(1), uid(2), uid(3)],
      confirms: [uid(1), uid(2)],       // uid(3) came back
      failDeletes: new Set([uid(2)]),   // uid(2) could not be deleted
    });
    await opSweepGuests(admin, request(SECRET));
    assertEquals(rec.purged.length, 1);
    assertEquals(rec.purged[0], [uid(1)]);
  });
});

Deno.test("nothing is purged when every delete failed", async () => {
  await withSecret(SECRET, async () => {
    const { admin, rec } = stub({
      marks: [uid(1)],
      failDeletes: new Set([uid(1)]),
    });
    await opSweepGuests(admin, request(SECRET));
    assertEquals(rec.purged, []);
  });
});

// --- bookkeeping -------------------------------------------------------------

Deno.test("an empty queue records nothing and calls nothing", async () => {
  await withSecret(SECRET, async () => {
    const { admin, rec } = stub({ marks: [] });
    const res = await opSweepGuests(admin, request(SECRET));
    assertEquals((await body(res)).considered, 0);
    assertEquals(rec.deleted, []);
    assertEquals(rec.runs, []);
  });
});

Deno.test("every run that did work leaves an audit row", async () => {
  // pg_net discards the response and cron only knows it POSTed, so this row is
  // the only durable record that the sweep ran.
  await withSecret(SECRET, async () => {
    const { admin, rec } = stub({
      marks: [uid(1), uid(2)],
      failDeletes: new Set([uid(2)]),
    });
    await opSweepGuests(admin, request(SECRET));
    assertEquals(rec.runs, [{ considered: 2, confirmed: 2, deleted: 1, failed: 1 }]);
  });
});
