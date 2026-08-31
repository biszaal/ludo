import type { GameState, TransitionOptions } from "./types.js";
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