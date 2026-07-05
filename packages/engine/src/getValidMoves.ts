import type { Color, GameState, Move, Token } from "./types.js";
import {
  FINISH_REL_INDEX,
  absoluteTrackIndex,
  fromRelativeIndex,
  isSafeSquare,
  toRelativeIndex,
} from "./board.js";
import { getPlayer } from "./internal.js";

/**
 * All legal moves for `playerId` given the current dice. Returns `[]` when it is
 * not the player's turn, no dice has been rolled, or the player is blocked — in
 * which case the caller ends the turn.
 *
 * Each entry is fully resolved (destination + captures + finish flag) so the UI
 * can preview outcomes and {@link applyMove} can be fed back verbatim.
 */
export function getValidMoves(state: GameState, playerId: string): Move[] {
  if (state.status !== "active") return [];
  if (state.currentTurnPlayerId !== playerId) return [];
  if (state.phase !== "awaiting-move" || state.diceValue === null) return [];

  const dice = state.diceValue;
  const color = getPlayer(state, playerId).color;
  const tokens = state.tokens.filter((t) => t.playerId === playerId);

  const moves: Move[] = [];
  for (const token of tokens) {
    const move = resolveMove(state, token, color, dice);
    if (move) moves.push(move);
  }
  return moves;
}

/** Resolve the single move a token can make with `dice`, or null if it cannot move. */
function resolveMove(state: GameState, token: Token, color: Color, dice: number): Move | null {
  if (token.position === "finished") return null;

  const relIndex = toRelativeIndex(color, token.position);

  // In the yard: leave only under the leave-yard rule, landing on the start cell.
  if (relIndex === null) {
    const canLeave = dice === 6 || !state.rules.leaveYardOnSix;
    if (!canLeave) return null;
    const to = fromRelativeIndex(color, 0);
    return buildMove(state, token, color, to);
  }

  const destRel = relIndex + dice;

  if (destRel > FINISH_REL_INDEX) {
    // Overshoots the center.
    if (state.rules.exactRollToFinish) return null;
    return buildMove(state, token, color, "finished");
  }

  const to = fromRelativeIndex(color, destRel);
  return buildMove(state, token, color, to);
}

/** Attach capture/finish metadata to a candidate destination. */
function buildMove(
  state: GameState,
  token: Token,
  color: Color,
  to: Token["position"],
): Move {
  const destAbs = absoluteTrackIndex(to);
  const captures = destAbs === null ? [] : computeCaptures(state, token.playerId, destAbs);
  return {
    tokenId: token.id,
    from: token.position,
    to,
    captures,
    finishes: to === "finished",
  };
}

/**
 * Ids of opponent tokens sent home by landing on `absIndex`. None on safe
 * squares. With blockades disabled (v1) a stacked pair offers no protection, so
 * every opponent token on the cell is captured.
 */
function computeCaptures(state: GameState, moverPlayerId: string, absIndex: number): string[] {
  if (state.rules.safeSquares && isSafeSquare(absIndex)) return [];
  return state.tokens
    .filter(
      (t) =>
        t.playerId !== moverPlayerId &&
        absoluteTrackIndex(t.position) === absIndex,
    )
    .map((t) => t.id);
}
