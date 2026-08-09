/**
 * Where a pawn travels between two positions, cell by cell.
 *
 * Extracted from Board.tsx so it is testable in Node (no Skia) and so the
 * timing in lib/moveTiming.ts can be derived from the SAME path instead of
 * re-deriving it — the two drifting apart is what makes landing sounds fire
 * against the wrong frame.
 */

import {
  FINISH_REL_INDEX,
  fromRelativeIndex,
  toRelativeIndex,
  type Color,
  type GameState,
  type TokenPosition,
} from "@ludo/engine";
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

/**
 * Where each token stood immediately BEFORE this state, read out of the state's
 * own `lastAction`.
 *
 * Board used to answer this from a ref updated in an effect after every render
 * — "whatever I drew last time". That is a cache of render history, and it only
 * has to be wrong once for a move to lose its animation: a wiped ref reads as
 * `undefined` (no previous cell), and a ref that has already run ahead reads as
 * "it was always here". Both collapse computeWaypoints to a straight fly, which
 * is exactly what a capture looked like on device — a five-cell move crossing
 * the board diagonally in 240ms, ignoring the track's corner.
 *
 * A move is already recorded authoritatively, so derive it instead:
 *
 *   lastAction = { type: "move", payload: { tokenId, to, captures, dice } }
 *
 * The mover came from `dice` steps back along its own path, and anything it
 * captured was standing on the cell it landed on. Same answer on every re-render
 * of the same state, so render order, effect timing and remounts stop mattering.
 *
 * Tokens not named by the action are absent from the map; the caller treats that
 * as "no travel", which is the correct fallback for a resync jump (the pawn
 * still moves to its seat, it just doesn't pretend to walk a path it may not
 * have taken).
 */
export function originsFromLastAction(state: GameState): Map<string, TokenPosition> {
  const out = new Map<string, TokenPosition>();
  const action = state.lastAction;
  if (!action || action.type !== "move") return out;

  const payload = action.payload as
    | { tokenId?: string; to?: TokenPosition; captures?: string[]; dice?: number }
    | null;
  if (!payload?.tokenId || payload.to === undefined || typeof payload.dice !== "number") return out;

  const mover = state.tokens.find((t) => t.id === payload.tokenId);
  if (mover) {
    const toRel = toRelativeIndex(mover.color, payload.to);
    if (toRel !== null) {
      const fromRel = toRel - payload.dice;
      // Below 0 means it came out of the yard — there is no path cell to walk
      // back to, and computeWaypoints flies a yard exit anyway.
      out.set(mover.id, fromRel >= 0 ? fromRelativeIndex(mover.color, fromRel) : "home");
    }
  }

  // Captured tokens were, by definition, on the cell the mover just landed on.
  for (const id of payload.captures ?? []) out.set(id, payload.to);

  return out;
}
