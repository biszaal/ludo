/**
 * Internal helpers shared by the transition functions. Not part of the public
 * API. All functions here are pure and never mutate their inputs.
 */
import type { GameState, LastAction, PlayerState, Token } from "./types.js";
/** Structured clone of a game state, safe to mutate locally before returning. */
export declare function cloneState(state: GameState): GameState;
export declare function getPlayer(state: GameState, playerId: string): PlayerState;
export declare function getCurrentPlayer(state: GameState): PlayerState;
export declare function getPlayerTokens(state: GameState, playerId: string): Token[];
export declare function getToken(state: GameState, tokenId: string): Token | undefined;
/** True if all of a player's tokens have finished. */
export declare function hasPlayerWon(state: GameState, playerId: string): boolean;
/**
 * Advance the clock to the next player in clockwise seat order, resetting the
 * per-turn dice state. Mutates the passed (already-cloned) state.
 */
export declare function advanceTurn(state: GameState): void;
export declare function makeAction(type: LastAction["type"], payload: unknown, now: number | undefined): LastAction;
//# sourceMappingURL=internal.d.ts.map