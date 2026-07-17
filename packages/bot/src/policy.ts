/**
 * Heuristic move-selection policy. Pure: given a state and the engine's own list
 * of valid moves, pick one. Reusable on client (fill empty seats) and server.
 *
 * Two brains behind one signature:
 * - "easy": the original tiered ladder — capture > finish > advance the token
 *   closest to finishing > leave the yard.
 * - "normal"/"hard" (default "hard"): a weighted score that also weighs capture
 *   RISK — escaping threatened tokens, not landing in an opponent's reach,
 *   grabbing safe squares — and, on hard, hunting prey and camping stars in
 *   ambush of traffic approaching from behind.
 */

import {
  absoluteTrackIndex,
  isSafeSquare,
  toRelativeIndex,
  type Color,
  type GameState,
  type Move,
} from "@ludo/engine";
import { chaseCount, opponentsBehind, threatProb } from "./threat.js";

export type BotDifficulty = "easy" | "normal" | "hard";

export interface BotOptions {
  /** Randomness for breaking ties between equally-ranked moves. */
  rng?: () => number;
  /** Strength of play; defaults to "hard". */
  difficulty?: BotDifficulty;
}

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

  let best: Move[] = [];
  let bestScore = -Infinity;
  for (const move of validMoves) {
    const s =
      difficulty === "easy"
        ? scoreEasy(color, move)
        : scoreSmart(state, playerId, color, move, difficulty === "hard");
    if (s > bestScore) {
      bestScore = s;
      best = [move];
    } else if (s === bestScore) {
      best.push(move);
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
 * Weighted score. Capture and finish stay dominant, but risk terms outweigh raw
 * progress (a certain-capture landing costs up to ~1300 vs progress's ≤ ~340),
 * so the bot detours around danger instead of marching the lead token into it.
 * Weights tuned by seeded self-play: ~60% win rate vs the easy ladder over
 * 1000 alternating-seat games (dice luck caps how far skill can push this).
 */
function scoreSmart(
  state: GameState,
  playerId: string,
  color: Color,
  move: Move,
  hard: boolean,
): number {
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

  if (hard) {
    // Offense: land where next turn's roll can reach prey…
    score += (250 * Math.min(chaseCount(state, playerId, move.to), 6)) / 6;
    // …and camp stars ahead of oncoming traffic: sit in ambush at no risk.
    if (toSafe && opponentsBehind(state, playerId, move.to, 12) > 0) score += 250;
  }

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
