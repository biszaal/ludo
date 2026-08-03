/**
 * Where a pawn travels between two positions, cell by cell.
 *
 * Extracted from Board.tsx so it is testable in Node (no Skia) and so the
 * timing in lib/moveTiming.ts can be derived from the SAME path instead of
 * re-deriving it — the two drifting apart is what makes landing sounds fire
 * against the wrong frame.
 */

import { FINISH_REL_INDEX, fromRelativeIndex, toRelativeIndex, type Color, type TokenPosition } from "@ludo/engine";
import { tokenCenterPx, type Point } from "./boardLayout";

/** Per-cell hop duration (ms) for an ordinary forward move. */
export const HOP_STEP_MS = 150;
/** Single-fly duration (ms) for a move with no walkable path (yard exits). */
export const FLY_MS = 240;

/**
 * A captured pawn retraces its whole route back to its yard, which can be 50+
 * cells — far too many to walk at HOP_STEP_MS. The return is budgeted as a
 * fixed total instead, so a long trek reads as a fast scurry and a short one
 * still resolves cell by cell.
 */
export const RETURN_TOTAL_MS = 620;
/** Never so fast the retrace becomes an unreadable blur. */
const RETURN_MIN_STEP_MS = 26;

export interface Walk {
  /** Pixel points to visit in order; the last is the pawn's final seat. */
  points: Point[];
  /** True to hop point-to-point; false to fly straight to the single point. */
  walk: boolean;
  /** Duration of each hop in `points`. */
  stepMs: number;
  /** A capture retrace — the Board mutes the per-cell thock over these. */
  retrace: boolean;
}

const fly = (dest: Point): Walk => ({ points: [dest], walk: false, stepMs: FLY_MS, retrace: false });

/**
 * Pixel waypoints from a token's previous position to its new seat.
 *
 * - Forward 1-6 cells: hops through every cell in between (a single-cell move
 *   still hops, it never slides).
 * - Captured (anything -> home): retraces its route backwards to its start
 *   cell, then drops into its yard slot — the "sent all the way back" beat.
 * - Everything else (yard exits, resync jumps): one straight fly.
 */
export function computeWaypoints(
  color: Color,
  prev: TokenPosition | undefined,
  current: TokenPosition,
  dest: Point,
  cell: number,
): Walk {
  if (prev === undefined) return fly(dest); // first render

  const oldRel = prev === "home" ? -1 : prev === "finished" ? FINISH_REL_INDEX : toRelativeIndex(color, prev);
  const newRel = current === "home" ? -1 : current === "finished" ? FINISH_REL_INDEX : toRelativeIndex(color, current);
  if (oldRel === null || newRel === null) return fly(dest);

  // Captured: walk the route home the way it came.
  if (newRel === -1 && oldRel >= 0) {
    const pts: Point[] = [];
    for (let rel = oldRel - 1; rel >= 0; rel--) {
      pts.push(tokenCenterPx(color, fromRelativeIndex(color, rel), 0, cell));
    }
    pts.push(dest); // into the yard slot
    return {
      points: pts,
      walk: true,
      stepMs: Math.max(RETURN_MIN_STEP_MS, Math.round(RETURN_TOTAL_MS / pts.length)),
      retrace: true,
    };
  }

  if (oldRel === -1) return fly(dest); // leaving the yard — no path to walk

  if (newRel > oldRel && newRel - oldRel <= 6) {
    const pts: Point[] = [];
    for (let rel = oldRel + 1; rel < newRel; rel++) {
      pts.push(tokenCenterPx(color, fromRelativeIndex(color, rel), 0, cell));
    }
    pts.push(dest);
    return { points: pts, walk: true, stepMs: HOP_STEP_MS, retrace: false };
  }

  return fly(dest);
}

/** How long {@link computeWaypoints} takes for this transition. */
export function walkDurationMs(color: Color, was: TokenPosition, now: TokenPosition): number {
  const w = computeWaypoints(color, was, now, { x: 0, y: 0 }, 1);
  return w.walk ? w.points.length * w.stepMs : FLY_MS;
}
