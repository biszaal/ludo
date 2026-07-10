/**
 * Timing of a token's move animation, shared by Board.tsx (which drives the
 * hops) and feedback.ts (which must not fire landing sounds — capture, safe
 * chime, finish — before the pawn visibly arrives). Pure module with engine
 * imports only, so the Node test suite can pin the math.
 */

import { FINISH_REL_INDEX, toRelativeIndex, type Color, type TokenPosition } from "@ludo/engine";

/** Per-cell hop duration (ms). Slower = more playful, child's-game pacing. */
export const HOP_STEP_MS = 175;
/** Single-fly duration (ms) for non-walkable moves: yard exits, capture returns. */
export const FLY_MS = 240;

/**
 * How long the Board animates a token from `was` to `now`. Mirror of Board's
 * computeWaypoints: a contiguous forward path of ≤6 cells hops cell-by-cell;
 * everything else (yard exits, capture returns, resync jumps) is one fly.
 */
export function moveDurationMs(color: Color, was: TokenPosition, now: TokenPosition): number {
  if (was === "home") return FLY_MS;
  const oldRel = was === "finished" ? FINISH_REL_INDEX : toRelativeIndex(color, was);
  const newRel = now === "home" ? -1 : now === "finished" ? FINISH_REL_INDEX : toRelativeIndex(color, now);
  if (oldRel === null || newRel === null) return FLY_MS;
  if (newRel > oldRel && newRel - oldRel <= 6) return (newRel - oldRel) * HOP_STEP_MS;
  return FLY_MS;
}
