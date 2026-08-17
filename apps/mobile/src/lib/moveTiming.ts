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
import { BUST_HOLD_MS, isBustHandoff } from "./projection";

export { FLY_MS, HOP_STEP_MS } from "../render/waypoints";

/**
 * How long the die tumble owns the screen: the animation itself plus a beat to
 * read the face it lands on.
 *
 * Defined here rather than in Dice.tsx because this module is the timing
 * authority the sync path consults, and it has to stay importable from Node
 * (see __tests__/moveTiming.test.ts) — Dice.tsx pulls in Skia. Dice.tsx imports
 * this constant so the animation and the hold can never drift apart.
 */
export const DICE_ROLL_MS = 700;
/** Beat after the die lands before the pawn is allowed to move. */
const DICE_READ_MS = 200;

/** Did `prev -> next` include a new roll landing on the board? */
function rolled(prev: GameState, next: GameState): boolean {
  return next.diceValue != null && prev.diceValue !== next.diceValue;
}

/** How long the Board animates a token from `was` to `now`. */
export function moveDurationMs(color: Color, was: TokenPosition, now: TokenPosition): number {
  return walkDurationMs(color, was, now);
}

/**
 * How long the Board animates `prev -> next` overall: the die tumble if this
 * transition rolled, then the slowest mover, plus a captured token's retrace
 * home (the Board holds that back until the capturing mover lands, so the two
 * are sequential, not concurrent).
 *
 * The roll leg matters more than it looks. A roll moves no token, so this used
 * to return 0 for one and the row queue held the next state for ROW_HOLD_PAD_MS
 * alone — 80ms against a 700ms tumble. On a connection that delivered the roll
 * and the move together, an opponent's pawn started hopping before their die
 * had visibly landed, and since the die only renders beside the active seat,
 * the number was gone before anyone could read it.
 */
export function stateAnimationMs(prev: GameState, next: GameState): number {
  if (prev.gameId !== next.gameId) return 0;
  // A busted third six moves no token, but the board still holds on the
  // roller's six before handing over. Without this the queue would consider the
  // transition instant and drop the next state on top of the hold.
  if (isBustHandoff(prev, next)) return BUST_HOLD_MS;
  const rollMs = rolled(prev, next) ? DICE_ROLL_MS + DICE_READ_MS : 0;
  const prevPos = new Map(prev.tokens.map((t) => [t.id, t.position]));
  let moverMs = 0;
  let captureMs = 0;
  for (const t of next.tokens) {
    const was = prevPos.get(t.id);
    if (was === undefined || JSON.stringify(was) === JSON.stringify(t.position)) continue;
    if (t.position === "home") captureMs = Math.max(captureMs, walkDurationMs(t.color, was, t.position));
    else moverMs = Math.max(moverMs, walkDurationMs(t.color, was, t.position));
  }
  return rollMs + moverMs + captureMs;
}
