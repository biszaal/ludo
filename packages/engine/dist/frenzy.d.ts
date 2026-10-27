import type { GameState, TransitionOptions } from "./types.js";
import type { Rng } from "./rng.js";
export interface FrenzyRollResult {
    newState: GameState;
    diceValue: number;
}
/**
 * Roll one seat's die in a Frenzy game. There are no turns: a seat in play may
 * roll whenever its die is empty, and there is no three-sixes forfeit because
 * there is no turn to lose. Read {@link getValidMoves} for the seat next; if it
 * is empty, clear the die with {@link frenzyPass}.
 *
 * How soon a seat may roll again (the recharge) is the caller's clock, not a
 * rule of the state. Pure: returns a new state.
 */
export declare function frenzyRoll(state: GameState, playerId: string, rng: Rng, options?: TransitionOptions): FrenzyRollResult;
/**
 * Clear a seat's die after a roll with no legal move — the Frenzy counterpart
 * of {@link endTurn}, with the same guard: you cannot throw a usable roll away.
 * Pure: returns a new state.
 */
export declare function frenzyPass(state: GameState, playerId: string, options?: TransitionOptions): GameState;
//# sourceMappingURL=frenzy.d.ts.map