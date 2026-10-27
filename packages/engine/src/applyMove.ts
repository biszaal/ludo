import type { GameState, Move, TransitionOptions } from "./types.js";
import { validateMove } from "./validateMove.js";
import { cloneState, endIfComplete, handOff, hasPlayerWon, makeAction, placePlayer } from "./internal.js";

/**
 * Apply a legal move and resolve the consequences: token advance, captures,
 * win check, and either a bonus roll or hand-off to the next player.
 *
 * The move is re-validated and re-resolved from `tokenId` against the engine's
 * own rules, so callers cannot smuggle in an illegal destination. Throws if the
 * move is not legal in `state`. Pure: returns a new state, never mutates input.
 *
 * In a Frenzy game the token's owner moves on their own die, which the move
 * spends; there is no turn to hand off, and the bonus a turn-based game would
 * grant is reported on `lastAction.payload.bonus` for the caller to honour.
 */
export function applyMove(
  state: GameState,
  move: Pick<Move, "tokenId">,
  options: TransitionOptions = {},
): GameState {
  const validation = validateMove(state, move);
  if (!validation.valid || !validation.resolved) {
    throw new Error(`Illegal move: ${validation.reason ?? "unknown reason"}`);
  }
  const resolved = validation.resolved;

  const next = cloneState(state);

  // 1. Advance the moving token.
  const token = next.tokens.find((t) => t.id === resolved.tokenId)!;
  token.position = resolved.to;
  // validateMove guarantees the token's owner is the one moving.
  const mover = token.playerId;
  const dice = state.frenzy ? state.frenzy.dice[mover]! : state.diceValue!;

  // 2. Send captured opponents back to their yard.
  for (const capturedId of resolved.captures) {
    const captured = next.tokens.find((t) => t.id === capturedId)!;
    captured.position = "home";
  }

  const placed = hasPlayerWon(next, mover);
  // Finished players earn no bonus turns.
  const earnedBonus =
    !placed &&
    ((dice === 6 && next.rules.extraTurnOnSix) ||
      (resolved.captures.length > 0 && next.rules.extraTurnOnCapture) ||
      (resolved.finishes && next.rules.extraTurnOnFinish));

  next.lastAction = makeAction(
    "move",
    next.frenzy
      ? { tokenId: resolved.tokenId, to: resolved.to, captures: resolved.captures, dice, playerId: mover, bonus: earnedBonus }
      : { tokenId: resolved.tokenId, to: resolved.to, captures: resolved.captures, dice },
    options.now,
  );

  if (next.frenzy) {
    next.frenzy.dice[mover] = null;
    if (placed) {
      placePlayer(next, mover);
      endIfComplete(next);
    }
    return next;
  }

  // 3. Finish check — the game plays to completion. A player who just got
  // their tokens home joins finishedOrder (first = the winner) and spectates;
  // play continues until a single in-play player remains, who is appended
  // last and the game ends with full standings.
  if (placed) {
    placePlayer(next, mover);
    // Hand off to the next in play, or end the game if that was the last of them.
    handOff(next);
    return next;
  }

  // 4. Bonus turn vs. hand-off.
  if (earnedBonus) {
    next.phase = "awaiting-roll";
    next.diceValue = null;
    // Preserve the six-streak only if this roll was itself a six.
    next.consecutiveSixes = dice === 6 ? next.consecutiveSixes : 0;
  } else {
    handOff(next);
  }

  return next;
}
