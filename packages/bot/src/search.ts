/**
 * Expectimax over the dice.
 *
 * The old policy answered "which move looks best right now". This answers the
 * question a competitive player actually asks: "which move leaves me best off
 * AFTER the other seats have rolled and replied as well as they can".
 *
 * Shape of one candidate:
 *
 *     my move ──▶ resulting state
 *                   ├─ game over                  → terminal value
 *                   ├─ I earned a bonus turn      → average over MY next 6 rolls
 *                   └─ someone else to act        → average over THEIR next 6
 *                                                    rolls, each answered with
 *                                                    their own best reply
 *                                                        └─ recurse to `depth`
 *
 * Chance nodes fan out by six (the die); decision nodes do NOT fan out. At each
 * one the actor's single best reply is picked by static evaluation and only
 * that line is followed. Branching therefore stays 6^depth instead of 18^depth,
 * which is what makes depth 2 affordable at all. It is the usual
 * principal-variation approximation: wrong when the best-looking reply is not
 * the best reply, cheap enough to buy two extra plies with the savings.
 *
 * Bonus turns are followed rather than flattened into a constant, so chaining a
 * six or a capture into another roll is valued by what the extra roll can
 * actually reach.
 *
 * Cost at a 4-player midgame on V8 is ~162µs per decision at depth 1 and ~948µs
 * at depth 2 — see __tests__/searchBudget.test.ts, which fails if that
 * regresses far enough to matter against the edge runtime's 200ms soft CPU
 * limit.
 */

import {
  applyMove,
  getValidMoves,
  toRelativeIndex,
  type GameState,
  type Move,
} from "@ludo/engine";
import { evaluateFor, tokenProgressValue } from "./evaluate.js";

/** The six faces, weighted uniformly. Materialised once. */
const DICE_FACES = [1, 2, 3, 4, 5, 6] as const;

/**
 * Extra weight on actually taking a token, over and above what the resulting
 * position is worth — a fraction of the progress the victim loses.
 *
 * This is a deliberate tilt, not a correction. The search already prices a
 * capture correctly: the victim shows up in the leaf position sitting in their
 * yard, and the bonus roll is followed rather than assumed. But "correctly" and
 * "the way this game is played" are not the same thing. Expectimax discounts a
 * kill by how cheaply the victim walks back out, and the honest answer is often
 * "quite cheaply" — which produces a bot that quietly declines contact and
 * races, and reads to a human opponent as a bot that isn't paying attention to
 * them. Ludo is a game people play at each other.
 *
 * Scaled by the victim's progress so it discriminates: sending a fresh token
 * back to the yard costs them almost nothing and this barely moves, while
 * knocking a runner off the doorstep of its home column is worth reaching for
 * and worth some risk. It is well under the ~40 points the evaluator already
 * pays for the same capture, so it tips close calls without ever outweighing a
 * win, a finish, or escaping a bigger loss of our own.
 *
 * Applies to OUR candidate moves only. Inside the search, opponents are still
 * modelled by static evaluation alone, so we credit them with the positional
 * value of a capture but not this appetite for one — a conservative asymmetry:
 * we never talk ourselves into a trade by assuming they will take the bait.
 */
const CAPTURE_APPETITE = 0.3;

/** The tilt for one candidate move: what its captures cost their owners. */
function captureAppetite(state: GameState, move: Move): number {
  if (move.captures.length === 0) return 0;
  let lost = 0;
  for (const id of move.captures) {
    const victim = state.tokens.find((t) => t.id === id);
    if (!victim) continue;
    lost += tokenProgressValue(toRelativeIndex(victim.color, victim.position));
  }
  return CAPTURE_APPETITE * lost;
}

export interface ScoredMove {
  move: Move;
  score: number;
  /** State the move produces, kept so a caller can extend the search further. */
  after: GameState;
}

/**
 * Re-point a state at `actorId` holding `die`, without going through the turn
 * machinery. Safe to hand to applyMove: every engine transition clones before
 * mutating, so the shared token objects are never written through.
 */
function probe(state: GameState, actorId: string, die: number): GameState {
  return {
    ...state,
    currentTurnPlayerId: actorId,
    phase: "awaiting-move",
    diceValue: die,
    consecutiveSixes: 0,
  };
}

/**
 * Expected value to `forPlayerId` once `actorId` rolls and plays their best
 * reply, averaged over all six faces.
 *
 * "Best reply" is the actor's own evaluation of the resulting position, not
 * ours — modelling them as a self-interested player rather than assuming they
 * cooperate. When the actor IS us the two evaluations coincide and the second
 * call is skipped.
 */
function expectedAfterRoll(
  state: GameState,
  actorId: string,
  forPlayerId: string,
  risk: number,
  depth: number,
): number {
  let total = 0;

  for (const die of DICE_FACES) {
    const rolled = probe(state, actorId, die);
    const replies = getValidMoves(rolled, actorId);

    if (replies.length === 0) {
      // Blocked: the actor forfeits the turn and the board stands as it is.
      total += evaluateFor(rolled, forPlayerId, risk);
      continue;
    }

    let bestForActor = -Infinity;
    let chosen = rolled;
    for (const reply of replies) {
      const next = applyMove(rolled, { tokenId: reply.tokenId });
      const actorValue = evaluateFor(next, actorId, risk);
      if (actorValue > bestForActor) {
        bestForActor = actorValue;
        chosen = next;
      }
    }
    total += valueOf(chosen, forPlayerId, risk, depth - 1);
  }

  return total / DICE_FACES.length;
}

/**
 * Value of a position to `forPlayerId`, expanding `depth` further plies of
 * roll-and-reply. Depth 0 is the static evaluation.
 */
function valueOf(after: GameState, forPlayerId: string, risk: number, depth: number): number {
  if (after.status === "finished" || depth <= 0) return evaluateFor(after, forPlayerId, risk);
  return expectedAfterRoll(after, after.currentTurnPlayerId, forPlayerId, risk, depth);
}

/**
 * Score every candidate move by searching `depth` plies past it. Returns them
 * in the order given, each with the state it produced.
 */
export function scoreMoves(
  state: GameState,
  playerId: string,
  moves: Move[],
  risk: number,
  depth: number,
): ScoredMove[] {
  const out: ScoredMove[] = [];
  for (const move of moves) {
    const after = applyMove(state, { tokenId: move.tokenId });
    out.push({
      move,
      after,
      score: valueOf(after, playerId, risk, depth) + captureAppetite(state, move),
    });
  }
  return out;
}
