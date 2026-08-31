import type { GameState, TransitionOptions } from "./types.js";
/** Rolls a player with nothing on the board gets to find a six. */
export declare const YARD_ROLLS = 3;
/**
 * Pass the turn to the next player. Used after a roll that produced no legal
 * moves (a forced pass).
 *
 * Guards against misuse: the player must have already rolled (`awaiting-move`)
 * and must genuinely have no legal move — you cannot skip a turn when a move is
 * available. Pure: returns a new state.
 */
export declare function endTurn(state: GameState, options?: TransitionOptions): GameState;
//# sourceMappingURL=endTurn.d.ts.map