/**
 * A roll on a folding table writes nothing and broadcasts the die.
 *
 * The die is HMAC(secret, gameId:state_version:playerId), so the move op can
 * re-derive it at the unchanged version. The write existed only to show other
 * players the number — ~2 bytes of information that was costing a 2.2KB
 * WAL-backed, RLS-scanned state document per subscriber.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { opTurn } from "./turn.ts";
import type { SupabaseClient } from "./lib.ts";
// @deno-types="../_shared/engine/index.d.ts"
import { createGame, type GameState } from "../_shared/engine/index.js";

const GAME = "33333333-3333-3333-3333-333333333333";
const USER = "44444444-4444-4444-4444-444444444444";

// Folding REQUIRES derivable dice: without a secret deriveDie returns null and
// rolls fall back to cryptoRng, which is random per call — the move op would
// then re-derive a different die than the roller was shown. Set it here so
// these tests exercise the real path rather than the fallback.
Deno.env.set("DICE_SECRET", "test-dice-secret-for-fold-equivalence");

interface Fake {
  admin: SupabaseClient;
  /** Patches written to `games`, newest last. */
  patches: Array<Record<string, unknown>>;
  row: { state: GameState; state_version: number };
}

function baseState(): GameState {
  return createGame(
    [
      { id: "p1", userId: USER, color: "red" },
      { id: "p2", userId: "u2", color: "yellow" },
    ],
    { gameId: GAME },
  );
}

function fake(foldWrites: boolean): Fake {
  const self: Fake = {
    admin: null as unknown as SupabaseClient,
    patches: [],
    row: { state: baseState(), state_version: 0 },
  };

  // deno-lint-ignore no-explicit-any
  const chain = (filters: Record<string, unknown>, settle: (f: Record<string, unknown>) => unknown): any => {
    // deno-lint-ignore no-explicit-any
    const node: any = {
      eq: (col: string, val: unknown) => chain({ ...filters, [col]: val }, settle),
      or: () => node,
      in: () => node,
      is: () => node,
      gt: () => node,
      select: () => node,
      maybeSingle: () => Promise.resolve(settle(filters)),
      single: () => Promise.resolve(settle(filters)),
      // deno-lint-ignore no-explicit-any
      then: (res: any, rej: any) => Promise.resolve(settle(filters)).then(res, rej),
    };
    return node;
  };

  const games = {
    select: () =>
      chain({}, () => ({
        data: {
          id: GAME,
          state: self.row.state,
          state_version: self.row.state_version,
          has_bots: false,
          fold_writes: foldWrites,
        },
        error: null,
      })),
    update: (patch: Record<string, unknown>) =>
      chain({}, (filters) => {
        if (filters["state_version"] !== self.row.state_version) return { data: null, error: null };
        self.patches.push(patch);
        self.row = {
          state: patch.state as GameState,
          state_version: patch.state_version as number,
        };
        return { data: { id: GAME }, error: null };
      }),
  };

  self.admin = {
    from: (table: string) => {
      if (table === "games") return games;
      // players / moves / rate_limits all no-op for these assertions.
      return {
        select: () => chain({}, () => ({ data: null, error: null })),
        update: () => chain({}, () => ({ data: null, error: null })),
        insert: () => chain({}, () => ({ data: null, error: null })),
      };
    },
    // deno-lint-ignore no-explicit-any
    rpc: () => Promise.resolve({ data: null, error: null }) as any,
    // deno-lint-ignore no-explicit-any
  } as any;

  return self;
}

/** Capture what broadcastToRoom puts on the wire, without a network. */
async function recordingBroadcasts<T>(
  run: () => Promise<T>,
): Promise<{ result: T; sent: Array<{ topic: string; event: string; payload: Record<string, unknown> }> }> {
  const sent: Array<{ topic: string; event: string; payload: Record<string, unknown> }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    for (const m of body.messages ?? []) sent.push(m);
    return Promise.resolve(new Response("{}", { status: 200 }));
    // deno-lint-ignore no-explicit-any
  }) as any;
  try {
    const result = await run();
    // afterResponse defers the send a microtask; let it land.
    await new Promise((r) => setTimeout(r, 0));
    return { result, sent };
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("a roll on a folding table does not write to games", async () => {
  const f = fake(true);
  await recordingBroadcasts(() => opTurn(f.admin, USER, GAME, "roll"));
  assertEquals(f.patches.length, 0);
});

Deno.test("a roll on a folding table broadcasts the die to the room", async () => {
  const f = fake(true);
  const { sent } = await recordingBroadcasts(() => opTurn(f.admin, USER, GAME, "roll"));

  assertEquals(sent.length, 1);
  assertEquals(sent[0]!.topic, `game:${GAME}`);
  assertEquals(sent[0]!.event, "roll");
  assertEquals(typeof sent[0]!.payload.die, "number");
  assertEquals(sent[0]!.payload.playerId, "p1");
  // At the PRE-roll version: that is the version the move op re-derives from.
  assertEquals(sent[0]!.payload.v, 0);
});

Deno.test("folding is refused when dice are not derivable", async () => {
  // DICE_SECRET unset => cryptoRng => the move op cannot reproduce this die.
  // The correct answer is to write, not to fold and hope.
  const previous = Deno.env.get("DICE_SECRET")!;
  Deno.env.delete("DICE_SECRET");
  try {
    const f = fake(true);
    const { sent } = await recordingBroadcasts(() => opTurn(f.admin, USER, GAME, "roll"));
    assertEquals(f.patches.length, 1);
    assertEquals(sent.length, 0);
  } finally {
    Deno.env.set("DICE_SECRET", previous);
  }
});

Deno.test("a roll on a NON-folding table writes exactly as it does today", async () => {
  // The compatibility test that protects live 1.0.1 players.
  const f = fake(false);
  const { sent } = await recordingBroadcasts(() => opTurn(f.admin, USER, GAME, "roll"));

  assertEquals(f.patches.length, 1);
  assertEquals(f.patches[0]!.state_version, 1);
  assertEquals(sent.length, 0);
});

Deno.test("the roller still receives its die in the HTTP response either way", async () => {
  const folding = await recordingBroadcasts(async () =>
    await (await opTurn(fake(true).admin, USER, GAME, "roll")).json()
  );
  const plain = await recordingBroadcasts(async () =>
    await (await opTurn(fake(false).admin, USER, GAME, "roll")).json()
  );

  assertEquals(typeof folding.result.state.diceValue, "number");
  assertEquals(folding.result.state.diceValue, plain.result.state.diceValue);
});

Deno.test("a retried roll on a folding table returns the die again, not a duplicate", async () => {
  // claimAction runs before the write for every action today. A folding roll
  // writes nothing, so if it still claimed an id the retry would be answered
  // "already applied" with state at v — still awaiting-roll, no die in it —
  // and the player would be left holding a die the server refuses to reissue.
  const f = fake(true);
  const first = await recordingBroadcasts(async () =>
    await (await opTurn(f.admin, USER, GAME, "roll", undefined, "act-1")).json()
  );
  const retry = await recordingBroadcasts(async () =>
    await (await opTurn(f.admin, USER, GAME, "roll", undefined, "act-1")).json()
  );

  assertEquals(retry.result.state.diceValue, first.result.state.diceValue);
  assertEquals(retry.result.duplicate, undefined);
  assertEquals(f.patches.length, 0);
});
