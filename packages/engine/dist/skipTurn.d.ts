import type { GameState, TransitionOptions } from "./types.js";
/**
 * Force the current turn to end and hand off to the next player, regardless of
 * phase — used for a timed-out turn (the player never rolled, or rolled and
 * never chose a move). Unlike `endTurn`, this makes no legality guarantees: it
 * always advances. Pure: returns a new state.
 *
 * A no-op-shaped call on a finished game throws, matching the other transitions.
 */
export declare function skipTurn(state: GameState, options?: TransitionOptions): GameState;
//# sourceMappingURL=skipTurn.d.ts.map