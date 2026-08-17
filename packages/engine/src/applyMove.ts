import type { GameState, Move, TransitionOptions } from "./types.js";
import { validateMove } from "./validateMove.js";
import { cloneState, handOff, hasPlayerWon, makeAction } from "./internal.js";

/**
 * Apply a legal move and resolve the consequences: token advance, captures,
 * win check, and either a bonus roll or hand-off to the next player.
 *
 * The move is re-validated and re-resolved from `tokenId` against the engine's
 * own rules, so callers cannot smuggle in an illegal destination. Throws if the
 * move is not legal in `state`. Pure: returns a new state, never mutates input.
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
  const dice = state.diceValue!;

  // 1. Advance the moving token.
  const token = next.tokens.find((t) => t.id === resolved.tokenId)!;
  token.position = resolved.to;

  // 2. Send captured opponents back to their yard.
  for (const capturedId of resolved.captures) {
    const captured = next.tokens.find((t) => t.id === capturedId)!;
    captured.position = "home";
  }

  next.lastAction = makeAction(
    "move",
    { tokenId: resolved.tokenId, to: resolved.to, captures: resolved.captures, dice },
    options.now,
  );

  // 3. Finish check — the game plays to completion. A player who just got all
  // four tokens home joins finishedOrder (first = the winner) and spectates;
  // play continues until a single in-play player remains, who is appended
  // last and the game ends with full standings.
  if (hasPlayerWon(next, state.currentTurnPlayerId)) {
    const mover = state.currentTurnPlayerId;
    if (!next.finishedOrder.includes(mover)) next.finishedOrder.push(mover);
    if (!next.winnerPlayerId) next.winnerPlayerId = next.finishedOrder[0]!;

    // Finished players earn no bonus turns — hand off to the next in play,
    // or end the game if that was the last of them.
    handOff(next);
    return next;
  }

  // 4. Bonus turn vs. hand-off.
  const earnedBonus =
    (dice === 6 && next.rules.extraTurnOnSix) ||
    (resolved.captures.length > 0 && next.rules.extraTurnOnCapture) ||
    (resolved.finishes && next.rules.extraTurnOnFinish);

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
