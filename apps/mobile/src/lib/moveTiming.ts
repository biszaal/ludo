/**
 * Timing of a token's move animation, shared by Board.tsx (which drives the
 * hops) and feedback.ts (which must not fire landing sounds — capture, safe
 * chime, finish — before the pawn visibly arrives). Pure module with engine
 * imports only, so the Node test suite can pin the math.
 */

import { FINISH_REL_INDEX, toRelativeIndex, type Color, type GameState, type TokenPosition } from "@ludo/engine";

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

/**
 * How long the Board animates the transition `prev -> next` overall: the
 * slowest mover, plus a captured token's fly home (Board delays it until the
 * capturing mover lands). Drives the online store's pacing of bunched realtime
 * updates: a laggy connection that delivers several writes at once must still
 * show each move, not collapse them into one jump.
 */
export function stateAnimationMs(prev: GameState, next: GameState): number {
  if (prev.gameId !== next.gameId) return 0;
  const prevPos = new Map(prev.tokens.map((t) => [t.id, t.position]));
  let moverMs = 0;
  let captureMs = 0;
  for (const t of next.tokens) {
    const was = prevPos.get(t.id);
    if (was === undefined || JSON.stringify(was) === JSON.stringify(t.position)) continue;
    if (t.position === "home") captureMs = FLY_MS; // captured — flies after the mover lands
    else moverMs = Math.max(moverMs, moveDurationMs(t.color, was, t.position));
  }
  return moverMs + captureMs;
}
