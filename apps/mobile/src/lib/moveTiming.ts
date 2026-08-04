/**
 * How long a state transition takes to play out on the Board.
 *
 * feedback.ts uses this so landing sounds (capture, safe chime, finish) fire
 * when the pawn visibly arrives, and onlineStore uses it to pace bunched
 * realtime updates — a laggy connection that delivers several writes at once
 * must still show each move rather than collapsing them into one jump.
 *
 * The durations are derived from render/waypoints.ts — the same function the
 * Board actually animates — rather than re-deriving them here. This used to be
 * a hand-kept mirror, and a mirror that drifts under-reports the animation,
 * which lets the next queued state land mid-hop and cut the move short.
 */

import type { Color, GameState, TokenPosition } from "@ludo/engine";
import { walkDurationMs } from "../render/waypoints";

export { FLY_MS, HOP_STEP_MS } from "../render/waypoints";

/** How long the Board animates a token from `was` to `now`. */
export function moveDurationMs(color: Color, was: TokenPosition, now: TokenPosition): number {
  return walkDurationMs(color, was, now);
}

/**
 * How long the Board animates `prev -> next` overall: the slowest mover, plus a
 * captured token's retrace home (the Board holds that back until the capturing
 * mover lands, so the two are sequential, not concurrent).
 */
export function stateAnimationMs(prev: GameState, next: GameState): number {
  if (prev.gameId !== next.gameId) return 0;
  const prevPos = new Map(prev.tokens.map((t) => [t.id, t.position]));
  let moverMs = 0;
  let captureMs = 0;
  for (const t of next.tokens) {
    const was = prevPos.get(t.id);
    if (was === undefined || JSON.stringify(was) === JSON.stringify(t.position)) continue;
    if (t.position === "home") captureMs = Math.max(captureMs, walkDurationMs(t.color, was, t.position));
    else moverMs = Math.max(moverMs, walkDurationMs(t.color, was, t.position));
  }
  return moverMs + captureMs;
}
