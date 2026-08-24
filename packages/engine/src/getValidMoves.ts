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

/**
 * Attach capture/finish metadata to a candidate destination.
 *
 * Every destination is reachable: a crowded cell is immune (see
 * {@link computeCaptures}), never barred. Landing on one just adds a token to
 * the pile.
 */
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
 * Ids of opponent tokens sent home by landing on `absIndex`.
 *
 * A cell already carrying two or more tokens is immune, and immunity counts
 * TOKENS rather than owners: the pile may be one player's pair, that pair with
 * an opponent stacked on top, or the single tokens two players are left with
 * after such a pile decays. All of them are two-deep, so none of them can be
 * captured — the cell only opens up again once it is back to one token.
 *
 * The mover's own token counts toward the pile, so bringing a second token
 * onto a cell shared with a lone opponent shields that opponent rather than
 * sending it home.
 *
 * Safe squares never capture, as before.
 */
function computeCaptures(state: GameState, moverPlayerId: string, absIndex: number): string[] {
  if (state.rules.safeSquares && isSafeSquare(absIndex)) return [];
  const occupants = state.tokens.filter((t) => absoluteTrackIndex(t.position) === absIndex);
  if (state.rules.protectStacks && occupants.length >= 2) return [];
  return occupants.filter((t) => t.playerId !== moverPlayerId).map((t) => t.id);
}
