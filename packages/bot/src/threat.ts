/**
 * Capture-risk helpers for the smart policy. Pure functions over the engine's
 * board model, all in ABSOLUTE track space (captures only happen there — yard,
 * home columns and the finish are uncapturable by construction).
 *
 * The dice model is the standard single-die approximation: an opponent token
 * 1–6 cells behind a square hits it with probability 1/6 per roll, so the
 * chance at least one of several stalkers connects is 1 − (5/6)^n. Home-column
 * diverts en route are ignored — close enough for move ranking.
 */

import {
  absoluteTrackIndex,
  isSafeSquare,
  MAIN_TRACK_SIZE,
  type GameState,
  type TokenPosition,
} from "@ludo/engine";

/** Is `abs` a cell where the rules forbid capture? */
function safeCell(state: GameState, abs: number): boolean {
  return state.rules.safeSquares && isSafeSquare(abs);
}

/** Opponent track tokens of `playerId` (the only pieces that threaten or flee). */
function opponentTrackTokens(state: GameState, playerId: string): number[] {
  const out: number[] = [];
  for (const t of state.tokens) {
    if (t.playerId === playerId) continue;
    const abs = absoluteTrackIndex(t.position);
    if (abs !== null) out.push(abs);
  }
  return out;
}

/**
 * Probability that an opponent's next roll captures a token of `playerId`
 * sitting at `pos`. 0 off the shared track and on safe squares.
 */
export function threatProb(state: GameState, playerId: string, pos: TokenPosition): number {
  const abs = absoluteTrackIndex(pos);
  if (abs === null || safeCell(state, abs)) return 0;
  let missAll = 1;
  for (const opp of opponentTrackTokens(state, playerId)) {
    const dist = (abs - opp + MAIN_TRACK_SIZE) % MAIN_TRACK_SIZE;
    if (dist >= 1 && dist <= 6) missAll *= 5 / 6;
  }
  return 1 - missAll;
}

/**
 * Capturable opponent tokens within one roll AHEAD of `pos` — prey a token
 * standing there could hunt next turn. Tokens parked on safe squares don't
 * count; they can't be taken.
 */
export function chaseCount(state: GameState, playerId: string, pos: TokenPosition): number {
  const abs = absoluteTrackIndex(pos);
  if (abs === null) return 0;
  let n = 0;
  for (const opp of opponentTrackTokens(state, playerId)) {
    const dist = (opp - abs + MAIN_TRACK_SIZE) % MAIN_TRACK_SIZE;
    if (dist >= 1 && dist <= 6 && !safeCell(state, opp)) n++;
  }
  return n;
}

/**
 * Opponent track tokens within `range` cells BEHIND `pos` — traffic that must
 * file past this square soon. A token camped on a safe cell here sits in
 * ambush: the passers-by land in its capture range while it risks nothing.
 */
export function opponentsBehind(
  state: GameState,
  playerId: string,
  pos: TokenPosition,
  range: number,
): number {
  const abs = absoluteTrackIndex(pos);
  if (abs === null) return 0;
  let n = 0;
  for (const opp of opponentTrackTokens(state, playerId)) {
    const dist = (abs - opp + MAIN_TRACK_SIZE) % MAIN_TRACK_SIZE;
    if (dist >= 1 && dist <= range) n++;
  }
  return n;
}
