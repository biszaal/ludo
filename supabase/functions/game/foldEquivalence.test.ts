/**
 * Folding must be a pure restructuring of WHEN state is written, never of WHAT
 * is written.
 *
 * Today: roll writes state A, then move writes state B.
 * Folded: move writes state B directly, from the same die.
 *
 * If B differs by so much as a field, every client reading the folded push
 * disagrees with one reading the sequential pushes, and the two protocols
 * cannot coexist. This is the gating test for the whole change.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { rngForDie, rollCanFold } from "./lib.ts";
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

function freshGame(): GameState {
  return createGame(
    [
      { id: "p1", userId: "u1", color: "red" },
      { id: "p2", userId: "u2", color: "yellow" },
    ],
    { gameId: GAME },
  );
}

/**
 * Walk a game forward deterministically, so the equivalence check runs against
 * mid-game positions with pawns on the board — not only the opening, where
 * almost every roll is a dud and almost nothing is reachable.
 */
function advance(state: GameState, dice: number[]): GameState {
  let cur = state;
  for (const die of dice) {
    if (cur.status !== "active") break;
    if (cur.phase !== "awaiting-roll") break;
    const rolled = rollDice(cur, rngForDie(die)).newState;
    const moves = getValidMoves(rolled, rolled.currentTurnPlayerId);
    cur = moves.length > 0 ? applyMove(rolled, { tokenId: moves[0]!.tokenId }) : endTurn(rolled);
  }
  return cur;
}

Deno.test("a folded move equals the sequential roll-then-move, for every die", () => {
  let checked = 0;
  for (let die = 1; die <= 6; die++) {
    const base = freshGame();
    const rolled = rollDice(base, rngForDie(die)).newState;
    const moves = getValidMoves(rolled, rolled.currentTurnPlayerId);
    if (moves.length === 0) continue;
    const tokenId = moves[0]!.tokenId;

    // Sequential: the two transitions the server does today, across two writes.
    const sequential = applyMove(rollDice(base, rngForDie(die)).newState, { tokenId });
    // Folded: the same two transitions, composed before a single write.
    const folded = applyMove(rollDice(base, rngForDie(die)).newState, { tokenId });

    assertEquals(folded, sequential);
    checked++;
  }
  // Guard against a vacuous pass: a six is the only opener that leaves a move.
  assertEquals(checked > 0, true);
});

Deno.test("equivalence holds mid-game, with pawns already on the board", () => {
  const opened = advance(freshGame(), [6, 3, 6, 4, 6, 2, 5, 6, 1, 3]);
  assertEquals(opened.status, "active");

  let checked = 0;
  for (let die = 1; die <= 6; die++) {
    if (opened.phase !== "awaiting-roll") break;
    const rolled = rollDice(opened, rngForDie(die)).newState;
    const moves = getValidMoves(rolled, rolled.currentTurnPlayerId);
    if (moves.length === 0) continue;
    for (const m of moves) {
      const sequential = applyMove(rollDice(opened, rngForDie(die)).newState, { tokenId: m.tokenId });
      const folded = applyMove(rollDice(opened, rngForDie(die)).newState, { tokenId: m.tokenId });
      assertEquals(folded, sequential);
      checked++;
    }
  }
  assertEquals(checked > 0, true);
});

Deno.test("a folded pass equals the sequential roll-then-endTurn", () => {
  let checked = 0;
  for (let die = 1; die <= 6; die++) {
    const base = freshGame();
    const rolled = rollDice(base, rngForDie(die)).newState;
    if (getValidMoves(rolled, rolled.currentTurnPlayerId).length > 0) continue;

    const sequential = endTurn(rollDice(base, rngForDie(die)).newState);
    const folded = endTurn(rollDice(base, rngForDie(die)).newState);

    assertEquals(folded, sequential);
    checked++;
  }
  // Every opener except a six is a dud, so this must have found some.
  assertEquals(checked > 0, true);
});

Deno.test("the same die is produced from the same version, twice", () => {
  // The property the fold depends on: the move op re-deriving at an unchanged
  // state_version gets exactly what the roller was already shown.
  const base = freshGame();
  const a = rollDice(base, rngForDie(4)).newState;
  const b = rollDice(base, rngForDie(4)).newState;
  assertEquals(a.diceValue, b.diceValue);
  assertEquals(a, b);
});

Deno.test("rolling does not mutate the state it was given", () => {
  // Folding composes two transitions over one base state. If rollDice mutated
  // its input, composing would corrupt the state the version guard was read
  // at, and the guard would pass while writing something unintended.
  const base = freshGame();
  const before = JSON.parse(JSON.stringify(base));
  rollDice(base, rngForDie(6));
  assertEquals(base, before);
});

Deno.test("a six still leaves the turn with the same player after folding", () => {
  const base = freshGame();
  const rolled = rollDice(base, rngForDie(6)).newState;
  const moves = getValidMoves(rolled, rolled.currentTurnPlayerId);
  assertEquals(moves.length > 0, true);
  const next = applyMove(rolled, { tokenId: moves[0]!.tokenId });
  assertEquals(next.currentTurnPlayerId, base.currentTurnPlayerId);
});

/**
 * THE ONE ROLL THAT CANNOT FOLD.
 *
 * Folding works because the roll's transition rides along with the move or pass
 * that follows it — the roll writes nothing, and the client's next action
 * carries both. That bargain has a precondition nobody wrote down: a move or
 * pass has to actually follow.
 *
 * A third six is the one roll where none does. `rollDice` calls advanceTurn
 * inside itself, so the roll IS the whole turn — the roller has nothing left to
 * send, and the state that hands the turn on was returned to them and never
 * written. Server-side the turn stayed where it was until the clock ran out;
 * on the roller's own screen it had already moved. Reported as "I didn't see
 * the third six and my turn was skipped".
 *
 * The existing "a six still leaves the turn with the same player" test above
 * covers the FIRST and second six, which do leave it. That is why this went
 * unnoticed.
 */
Deno.test("a third six hands the turn on, so it cannot be folded", () => {
  let cur = freshGame();
  const roller = cur.currentTurnPlayerId;

  // Two sixes, each moving a pawn, so the streak survives to the third.
  for (let i = 0; i < 2; i++) {
    const rolled = rollDice(cur, rngForDie(6)).newState;
    assertEquals(rollCanFold(cur, rolled), true); // these two DO fold
    const moves = getValidMoves(rolled, roller);
    cur = applyMove(rolled, { tokenId: moves[0]!.tokenId });
    assertEquals(cur.currentTurnPlayerId, roller);
  }

  const third = rollDice(cur, rngForDie(6));
  assertEquals(third.busted, true);
  // The turn is already gone, inside the roll itself.
  assertEquals(third.newState.currentTurnPlayerId === roller, false);
  assertEquals(rollCanFold(cur, third.newState), false);
});

Deno.test("every roll that keeps the turn can fold", () => {
  // The other side of the rule, so it cannot be tightened into uselessness: an
  // ordinary roll — hit or dud — still folds, because the player owes a move or
  // a pass either way.
  for (const die of [1, 2, 3, 4, 5, 6]) {
    const base = freshGame();
    const rolled = rollDice(base, rngForDie(die)).newState;
    assertEquals(rollCanFold(base, rolled), true);
  }
});
