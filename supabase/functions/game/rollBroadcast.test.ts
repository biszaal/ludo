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
import { rngForDie, type SupabaseClient } from "./lib.ts";
// @deno-types="../_shared/engine/index.d.ts"
import {
  applyMove,
  createGame,
  endTurn,
  getValidMoves,
  rollDice,
  type GameState,
} from "../_shared/engine/index.js";

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

function fake(foldWrites: boolean, startState: GameState = baseState()): Fake {
  const self: Fake = {
    admin: null as unknown as SupabaseClient,
    patches: [],
    row: { state: startState, state_version: 0 },
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

// --- Task 5: the fold itself ------------------------------------------------

/** Roll on a folding table (which writes nothing), then act. */
async function rollThen(
  f: Fake,
  action: "move" | "pass",
  tokenId?: string,
): Promise<{ die: number; body: Record<string, unknown> }> {
  const { result, sent } = await recordingBroadcasts(async () =>
    await (await opTurn(f.admin, USER, GAME, "roll")).json()
  );
  const die = Number(sent[0]!.payload.die);
  // The roll did not advance the version, so the act reads the same state.
  const body = await recordingBroadcasts(async () =>
    await (await opTurn(f.admin, USER, GAME, action, tokenId)).json()
  );
  void result;
  return { die, body: body.result as Record<string, unknown> };
}

/**
 * A position with red already on the board, so almost any die yields a legal
 * move. Testing the fold only from the opening would be near-vacuous: every
 * opener but a six is a dud, and the move path would never run.
 */
function redPawnOut(): GameState {
  const opened = rollDice(baseState(), rngForDie(6)).newState;
  const moves = getValidMoves(opened, opened.currentTurnPlayerId);
  return applyMove(opened, { tokenId: moves[0]!.tokenId });
}

Deno.test("a move on a folding table applies the roll and the move in one write", async () => {
  const start = redPawnOut();
  // A six keeps the turn with red, so red is still to play here.
  assertEquals(start.currentTurnPlayerId, "p1");
  const f = fake(true, start);

  const { sent } = await recordingBroadcasts(() => opTurn(f.admin, USER, GAME, "roll"));
  const die = Number(sent[0]!.payload.die);
  const rolled = rollDice(start, rngForDie(die)).newState;
  const moves = getValidMoves(rolled, rolled.currentTurnPlayerId);
  // With a pawn out this must not be vacuous — fail loudly if it becomes so.
  assertEquals(moves.length > 0, true);

  assertEquals(f.patches.length, 0); // the roll wrote nothing
  await recordingBroadcasts(() => opTurn(f.admin, USER, GAME, "move", moves[0]!.tokenId));

  assertEquals(f.patches.length, 1);
  assertEquals(f.patches[0]!.state_version, 1);
  // The single write is exactly the two transitions composed.
  assertEquals(f.patches[0]!.state, applyMove(rolled, { tokenId: moves[0]!.tokenId }));
});

Deno.test("a pass on a folding table also costs one write", async () => {
  const f = fake(true);
  const { sent } = await recordingBroadcasts(() => opTurn(f.admin, USER, GAME, "roll"));
  const die = Number(sent[0]!.payload.die);
  const rolled = rollDice(baseState(), rngForDie(die)).newState;
  if (getValidMoves(rolled, rolled.currentTurnPlayerId).length > 0) return; // not a dud

  await recordingBroadcasts(() => opTurn(f.admin, USER, GAME, "pass"));

  assertEquals(f.patches.length, 1);
  assertEquals(f.patches[0]!.state_version, 1);
});

Deno.test("the folded write carries the same die the roller was shown", async () => {
  const f = fake(true);
  const { sent } = await recordingBroadcasts(() => opTurn(f.admin, USER, GAME, "roll"));
  const shown = Number(sent[0]!.payload.die);
  const rolled = rollDice(baseState(), rngForDie(shown)).newState;
  const moves = getValidMoves(rolled, rolled.currentTurnPlayerId);
  const action = moves.length > 0 ? "move" : "pass";

  await recordingBroadcasts(() =>
    opTurn(f.admin, USER, GAME, action, moves[0]?.tokenId)
  );

  const written = f.patches[0]!.state as GameState;
  // On a pass the die is cleared by the handoff, so check what was applied via
  // the resulting position instead: re-running the same transition must match.
  const expected = moves.length > 0
    ? applyMove(rollDice(baseState(), rngForDie(shown)).newState, { tokenId: moves[0]!.tokenId })
    : endTurn(rollDice(baseState(), rngForDie(shown)).newState);
  assertEquals(written, expected);
});

Deno.test("reconnecting mid-turn re-rolls to the same die", async () => {
  // A client that drops after rolling refetches, sees awaiting-roll at v, and
  // rolls again. Because the die derives from the unchanged v it gets the same
  // number — self-healing, with no recovery path to write.
  const f = fake(true);
  const first = await recordingBroadcasts(() => opTurn(f.admin, USER, GAME, "roll"));
  const again = await recordingBroadcasts(() => opTurn(f.admin, USER, GAME, "roll"));

  assertEquals(Number(again.sent[0]!.payload.die), Number(first.sent[0]!.payload.die));
  assertEquals(f.patches.length, 0);
});

Deno.test("a move on a non-folding table still costs two writes", async () => {
  // Compatibility: live 1.0.1 tables keep today's exact sequence.
  const f = fake(false);
  await recordingBroadcasts(() => opTurn(f.admin, USER, GAME, "roll"));
  assertEquals(f.patches.length, 1);

  const rolledState = f.patches[0]!.state as GameState;
  const moves = getValidMoves(rolledState, rolledState.currentTurnPlayerId);
  const action = moves.length > 0 ? "move" : "pass";
  await recordingBroadcasts(() => opTurn(f.admin, USER, GAME, action, moves[0]?.tokenId));

  assertEquals(f.patches.length, 2);
});
