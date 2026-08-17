/**
 * Heuristic move-selection policy. Pure: given a state and the engine's own list
 * of valid moves, pick one. Reusable on client (fill empty seats) and server.
 *
 * Three brains behind one signature:
 * - "easy": the original tiered ladder — capture > finish > advance the token
 *   closest to finishing > leave the yard.
 * - "normal": a weighted score that also weighs capture RISK — escaping
 *   threatened tokens, not landing in an opponent's reach, grabbing safe
 *   squares — plus hunting prey and camping stars in ambush of traffic
 *   approaching from behind. This was the old "hard".
 * - "hard" (the default): one-ply expectimax. Every candidate is played out,
 *   the next seat's six possible rolls are each answered with their own best
 *   reply, and the resulting positions are valued by evaluate.ts. Leader
 *   targeting, ahead/behind risk appetite and bonus-turn chaining all fall out
 *   of the evaluator rather than being bolted on as rules.
 *
 * The tiers stay because callers still want a weak opponent sometimes; nothing
 * in the codebase asks for one today, but deleting the ladder to add a search
 * would be throwing away the only dial we have.
 */

import {
  absoluteTrackIndex,
  isSafeSquare,
  toRelativeIndex,
  type Color,
  type GameState,
  type Move,
} from "@ludo/engine";
import { riskAppetite } from "./evaluate.js";
import { scoreMoves } from "./search.js";
import { chaseCount, opponentsBehind, threatProb } from "./threat.js";

export type BotDifficulty = "easy" | "normal" | "hard";

export interface BotOptions {
  /** Randomness for breaking ties between equally-ranked moves. */
  rng?: () => number;
  /** Strength of play; defaults to "hard". */
  difficulty?: BotDifficulty;
  /** Plies of roll-and-reply the "hard" search expands past each candidate.
   *  Defaults to {@link DEFAULT_SEARCH_DEPTH}. Ignored by the other tiers. */
  depth?: number;
}

/**
 * Plies of roll-and-reply "hard" expands past each candidate.
 *
 * Measured over seeded self-play rather than guessed, because the honest answer
 * turned out to be "barely":
 *
 *   depth 2 vs depth 1, heads-up, 700 games ....... 54.0%  (z = 2.1)
 *   depth 2 vs depth 1, one seat in a 4p table .... +0.3pt (1σ = 1.1pt — noise)
 *   cost, 4-player midgame ........................ 948µs vs 162µs per decision
 *
 * So depth 2 is a real but small heads-up edge and an unresolvable one at a
 * full table, bought for 6x the CPU. It stays the default only because the
 * absolute cost is still tiny — ~23ms across a whole 24-action bot run, ~11% of
 * the edge runtime's 200ms soft CPU limit. Depth 3 was abandoned: it could not
 * finish a measurement run in ten minutes.
 *
 * If bot CPU ever needs to come down, dropping to 1 is the cheapest 6x
 * available and costs almost nothing at a 4-player table.
 */
export const DEFAULT_SEARCH_DEPTH = 2;

/**
 * Choose a move for `playerId` from `validMoves` (which must be the engine's
 * valid moves for that player). Throws if `validMoves` is empty.
 */
export function chooseMove(
  state: GameState,
  playerId: string,
  validMoves: Move[],
  options: BotOptions = {},
): Move {
  if (validMoves.length === 0) {
    throw new Error("chooseMove called with no valid moves.");
  }
  if (validMoves.length === 1) return validMoves[0]!;

  const color = state.players.find((p) => p.id === playerId)!.color;
  const rng = options.rng ?? Math.random;
  const difficulty = options.difficulty ?? "hard";

  const scores =
    difficulty === "hard"
      ? scoreMoves(
          state,
          playerId,
          validMoves,
          riskAppetite(state, playerId),
          options.depth ?? DEFAULT_SEARCH_DEPTH,
        ).map((s) => s.score)
      : validMoves.map((move) =>
          difficulty === "easy" ? scoreEasy(color, move) : scoreSmart(state, playerId, color, move),
        );

  let best: Move[] = [];
  let bestScore = -Infinity;
  for (let i = 0; i < validMoves.length; i++) {
    const s = scores[i]!;
    if (s > bestScore) {
      bestScore = s;
      best = [validMoves[i]!];
    } else if (s === bestScore) {
      best.push(validMoves[i]!);
    }
  }

  return best[Math.floor(rng() * best.length)]!;
}

/**
 * The original ladder. Tiers are spaced far enough apart that a higher-priority
 * concern always outranks a lower one:
 *   captures ≫ finishing ≫ advance-closest-to-finish ≫ leave yard.
 */
function scoreEasy(color: Color, move: Move): number {
  let score = 0;
  score += move.captures.length * 10_000;
  if (move.finishes) score += 5_000;

  if (move.from === "home") {
    score += 100; // leaving the yard, ranked below advancing a token in play
  } else {
    // Prefer moving the token nearest the finish (its current progress).
    const progress = toRelativeIndex(color, move.from) ?? 0;
    score += progress * 10;
  }
  return score;
}

/**
 * Weighted score — the "normal" tier, and the strength bar the search has to
 * clear. Capture and finish stay dominant, but risk terms outweigh raw progress
 * (a certain-capture landing costs up to ~1300 vs progress's ≤ ~340), so it
 * detours around danger instead of marching the lead token into it. Weights
 * tuned by seeded self-play: ~60% win rate vs the easy ladder over 1000
 * alternating-seat games (dice luck caps how far skill can push this).
 */
function scoreSmart(state: GameState, playerId: string, color: Color, move: Move): number {
  let score = 0;

  if (move.captures.length > 0) {
    // Killing an advanced token hurts the opponent most — it restarts a long walk.
    let victimProgress = 0;
    for (const id of move.captures) {
      const victim = state.tokens.find((t) => t.id === id);
      if (!victim) continue;
      victimProgress = Math.max(victimProgress, toRelativeIndex(victim.color, victim.position) ?? 0);
    }
    score += 12_000 * move.captures.length + 40 * victimProgress;
  }
  if (move.finishes) score += 6_000;

  const fromProgress = move.from === "home" ? 0 : toRelativeIndex(color, move.from) ?? 0;
  const toProgress = toRelativeIndex(color, move.to) ?? 0;

  // Defense: pull threatened tokens out of the line of fire (the more invested
  // the token, the more urgent), and don't land inside an opponent's reach.
  score += threatProb(state, playerId, move.from) * (400 + 10 * fromProgress);
  score -= threatProb(state, playerId, move.to) * (700 + 12 * toProgress);

  // Reaching cover: a safe square, or turning into the private home column.
  // Yard entries don't earn it — the start cell is safe by definition, and
  // rewarding it made every 6 an auto-enter over rescuing threatened runners.
  const toAbs = absoluteTrackIndex(move.to);
  const toSafe = toAbs !== null && state.rules.safeSquares && isSafeSquare(toAbs);
  const entersHomePath = typeof move.to === "object" && move.to.type === "homePath";
  if ((toSafe || entersHomePath) && move.from !== "home") score += 600;

  // Offense: land where next turn's roll can reach prey…
  score += (250 * Math.min(chaseCount(state, playerId, move.to), 6)) / 6;
  // …and camp stars ahead of oncoming traffic: sit in ambush at no risk.
  if (toSafe && opponentsBehind(state, playerId, move.to, 12) > 0) score += 250;

  if (move.from === "home") {
    // Spread: a lone runner is fragile — bring reinforcements out early.
    const onBoard = state.tokens.filter(
      (t) => t.playerId === playerId && typeof t.position === "object",
    ).length;
    score += onBoard < 2 ? 250 : 80;
  }

  score += 6 * toProgress;
  return score;
}
