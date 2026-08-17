import type { GameState, TransitionOptions } from "./types.js";
import { getValidMoves } from "./getValidMoves.js";
import { cloneState, handOff, makeAction } from "./internal.js";

/**
 * Pass the turn to the next player. Used after a roll that produced no legal
 * moves (a forced pass).
 *
 * Guards against misuse: the player must have already rolled (`awaiting-move`)
 * and must genuinely have no legal move — you cannot skip a turn when a move is
 * available. Pure: returns a new state.
 */
export function endTurn(state: GameState, options: TransitionOptions = {}): GameState {
  if (state.status !== "active") {
    throw new Error(`Cannot end turn: game is not active (status: ${state.status}).`);
  }
  if (state.phase !== "awaiting-move") {
    throw new Error("Cannot end turn before rolling.");
  }
  if (getValidMoves(state, state.currentTurnPlayerId).length > 0) {
    throw new Error("Cannot end turn while a legal move is available.");
  }

  const next = cloneState(state);
  next.lastAction = makeAction("endTurn", { playerId: state.currentTurnPlayerId }, options.now);
  handOff(next);
  return next;
}
