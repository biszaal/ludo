import type { GameState, TransitionOptions } from "./types.js";
import type { Rng } from "./rng.js";
import { rollDie } from "./rng.js";
import { advanceTurn, cloneState, makeAction } from "./internal.js";

export interface RollResult {
  newState: GameState;
  diceValue: number;
  /** True if a third consecutive six forfeited the turn (no move follows). */
  busted: boolean;
}

/**
 * Roll the dice for the current player. Randomness is injected via `rng` so the
 * function stays pure and deterministic for a given source.
 *
 * Transitions `awaiting-roll → awaiting-move`, except when a third consecutive
 * six forfeits the turn (under the three-sixes rule), in which case the turn is
 * handed off immediately. The caller should then read {@link getValidMoves}; if
 * empty, call {@link endTurn} to pass.
 */
export function rollDice(
  state: GameState,
  rng: Rng,
  options: TransitionOptions = {},
): RollResult {
  if (state.status !== "active") {
    throw new Error(`Cannot roll: game is not active (status: ${state.status}).`);
  }
  if (state.phase !== "awaiting-roll") {
    throw new Error("Cannot roll: a dice value is already pending a move.");
  }

  const diceValue = rollDie(rng);
  const next = cloneState(state);

  if (diceValue === 6) {
    const streak = next.consecutiveSixes + 1;
    if (next.rules.threeSixesForfeit && streak >= 3) {
      next.lastAction = makeAction("roll", { dice: 6, busted: true }, options.now);
      advanceTurn(next); // resets consecutiveSixes and clears the die
      return { newState: next, diceValue, busted: true };
    }
    next.consecutiveSixes = streak;
  }

  next.diceValue = diceValue;
  next.phase = "awaiting-move";
  next.lastAction = makeAction("roll", { dice: diceValue, busted: false }, options.now);

  return { newState: next, diceValue, busted: false };
}
