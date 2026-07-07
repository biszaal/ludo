import type { GameState, TransitionOptions } from "./types.js";
import type { Rng } from "./rng.js";
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
export declare function rollDice(state: GameState, rng: Rng, options?: TransitionOptions): RollResult;
//# sourceMappingURL=rollDice.d.ts.map