/**
 * The dry-turn counter must survive FOLDING.
 *
 * The rescue in lib.ts reads `games.dry_turns`, a per-seat count of consecutive
 * turns rolled with no six and no legal move. The count is fed by turn writes —
 * and folding changed which write a roll arrives in, not whether one happened.
 *
 * On a folding table the roll writes nothing at all: the move or pass the player
 * sends next carries both transitions in a single write. So the write that lands
 * says `move` or `pass`, and a counter gated on the ACTION NAME never moved for
 * a folded roll. Every modern client folds, so the streak could not climb for a
 * human seat, and the guarantee at eight dry turns had never fired in production
 * — a fortnight of live data showed 2 human `roll` writes against 551 moves and
 * 97 passes, with no stored count above 3 anywhere.
 *
 * These drive the real `opTurn` against a fake row, because the hole was in the
 * seam between the two protocols and neither one's own tests could see it.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
// @deno-types="../_shared/engine/index.d.ts"
import { createGame, getValidMoves, type GameState } from "../_shared/engine/index.js";
import { opTurn } from "./turn.ts";
import {
  deriveDie,
  dryTurnsFor,
  rngForDie,
  DRY_TURNS_THRESHOLD,
  type SupabaseClient,
} from "./lib.ts";
// @deno-types="../_shared/engine/index.d.ts"
import { rollDice } from "../_shared/engine/index.js";

// Folding is only reachable with a derivable die — without DICE_SECRET the
// server deliberately refuses to fold (see the precondition in turn.ts).
Deno.env.set("DICE_SECRET", "dry-turn-fold-test-secret");

const ME = "aaaaaaaa-0000-0000-0000-000000000001";
const THEM = "bbbbbbbb-0000-0000-0000-000000000002";

function freshGame(gameId: string): GameState {
  return createGame(
    [
      { id: "p1", userId: ME, color: "red" },
      { id: "p2", userId: THEM, color: "yellow" },
    ],
    { gameId },
  );
}

interface Fake {
  admin: SupabaseClient;
  row: {
    state: GameState;
    state_version: number;
    fold_writes: boolean;
    dry_turns: Record<string, number>;
  };
  writes: number;
}

/** The admin client chains opTurn walks, with fold_writes and dry_turns real. */
function fake(gameId: string, state: GameState, dry: Record<string, number> = {}): Fake {
  const self: Fake = {
    admin: null as unknown as SupabaseClient,
    row: { state, state_version: 0, fold_writes: true, dry_turns: dry },
    writes: 0,
  };

  // deno-lint-ignore no-explicit-any
  const chain = (filters: Record<string, unknown>, settle: (f: Record<string, unknown>) => unknown): any => {
    // deno-lint-ignore no-explicit-any
    const node: any = {
      eq: (col: string, val: unknown) => chain({ ...filters, [col]: val }, settle),
      or: () => node,
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
          id: gameId,
          state: self.row.state,
          state_version: self.row.state_version,
          has_bots: false,
          fold_writes: self.row.fold_writes,
          dry_turns: self.row.dry_turns,
        },
        error: null,
      })),
    update: (patch: Record<string, unknown>) =>
      chain({}, (filters) => {
        if (filters["state_version"] !== self.row.state_version) return { data: null, error: null };
        self.row = {
          state: patch.state as GameState,
          state_version: patch.state_version as number,
          fold_writes: self.row.fold_writes,
          // Exactly the merge Postgres does: a patch without the column leaves
          // the stored value alone, which is the whole bug.
          dry_turns: "dry_turns" in patch
            ? (patch.dry_turns as Record<string, number>)
            : self.row.dry_turns,
        };
        self.writes += 1;
        return { data: { id: gameId }, error: null };
      }),
  };

  const moves = {
    select: () => chain({}, () => ({ data: null, error: null })),
    insert: () => Promise.resolve({ data: null, error: null }),
    delete: () => chain({}, () => ({ data: null, error: null })),
  };
  const players = {
    select: () => chain({}, () => ({ data: { missed_turns: 0 }, error: null })),
    update: () => chain({}, () => ({ data: null, error: null })),
  };

  self.admin = {
    from: (table: string) => {
      if (table === "games") return games;
      if (table === "moves") return moves;
      return players;
    },
  } as unknown as SupabaseClient;
  return self;
}

/**
 * A game id whose opening die for p1 is not a six.
 *
 * A six opens the yard, which is a legal move and therefore not a dry turn at
 * all — the case under test needs the dud. The die is a pure derivation, so
 * this searches rather than hopes.
 */
async function gameWithOpeningDud(dry: number): Promise<{ gameId: string; die: number }> {
  for (let n = 1; n < 64; n++) {
    const gameId = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    // Derived at the count the op itself will read: past the threshold the
    // rescue biases the die, so a dud picked at 0 is not the die that gets
    // rolled at 7. Asking at the real count is the only honest search.
    const die = await deriveDie(gameId, 0, "p1", dry);
    if (die !== null && die !== 6) return { gameId, die };
  }
  throw new Error("no non-six opening die found");
}

Deno.test({
  name: "a folded dud advances the dry-turn streak",
  // opTurn broadcasts the folded die fire-and-forget; the send outlives the
  // call by design (afterResponse) and is not this test's business.
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { gameId, die } = await gameWithOpeningDud(0);
    const state = freshGame(gameId);
    // Precondition: this really is a dead turn — every pawn in the yard and no
    // six, so the roll leaves the seat nothing to do but pass.
    const rolled = rollDice(state, rngForDie(die)).newState;
    assertEquals(getValidMoves(rolled, "p1").length, 0);

    const f = fake(gameId, state);

    // The roll folds: it answers the player and writes nothing.
    const roll = (await (await opTurn(f.admin, ME, gameId, "roll", undefined, "act-1")).json()) as {
      folded?: boolean;
    };
    assertEquals(roll.folded, true);
    assertEquals(f.writes, 0);

    // The pass carries both transitions — and must carry the bookkeeping too.
    await opTurn(f.admin, ME, gameId, "pass", undefined, "act-2");
    assertEquals(f.writes, 1);
    assertEquals(dryTurnsFor(f.row.dry_turns, "p1"), 1);
  },
});

Deno.test({
  name: "a folded dud climbs an existing streak rather than restarting it",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    // Below the threshold on purpose: the die is still the honest one here, so
    // the turn really is dead and the count is the only thing under test.
    const start = DRY_TURNS_THRESHOLD - 3;
    const { gameId, die } = await gameWithOpeningDud(start);
    const state = freshGame(gameId);
    assertEquals(getValidMoves(rollDice(state, rngForDie(die)).newState, "p1").length, 0);

    const f = fake(gameId, state, { p1: start });
    await opTurn(f.admin, ME, gameId, "roll", undefined, "act-1");
    await opTurn(f.admin, ME, gameId, "pass", undefined, "act-2");
    assertEquals(dryTurnsFor(f.row.dry_turns, "p1"), start + 1);
  },
});

Deno.test({
  name: "the streak a folded turn feeds actually reaches the rescue",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    // The whole point, end to end: a seat carried to the certainty rung by
    // folded writes is handed its six. This is what production could not do —
    // the count never climbed, so this rung was unreachable for a human.
    const gameId = "00000000-0000-4000-a000-000000000001";
    const f = fake(gameId, freshGame(gameId), { p1: DRY_TURNS_THRESHOLD + 2 });
    const res = (await (await opTurn(f.admin, ME, gameId, "roll", undefined, "act-1")).json()) as {
      state?: GameState;
    };
    assertEquals(res.state!.diceValue, 6);
  },
});

Deno.test({
  name: "a folded roll that DID leave a move resets the streak",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    // The reset half of the rule has to survive folding too, or a seat that got
    // moving would keep a stale streak and be rescued later for nothing.
    for (let n = 1; n < 64; n++) {
      const gameId = `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
      // Derived at the same count the op will read, or the op rolls a different
      // die than this loop chose.
      if ((await deriveDie(gameId, 0, "p1", 4)) !== 6) continue;

      const state = freshGame(gameId);
      const f = fake(gameId, state, { p1: 4 });
      await opTurn(f.admin, ME, gameId, "roll", undefined, "act-1");
      const moves = getValidMoves(rollDice(state, rngForDie(6)).newState, "p1");
      assertEquals(moves.length > 0, true);
      await opTurn(f.admin, ME, gameId, "move", moves[0]!.tokenId, "act-2");
      assertEquals(dryTurnsFor(f.row.dry_turns, "p1"), 0);
      return;
    }
    throw new Error("no six-opening game found");
  },
});
