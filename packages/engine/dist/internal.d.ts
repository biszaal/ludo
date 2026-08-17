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
 * Players still racing: neither placed in `finishedOrder` nor departed.
 *
 * This set only ever shrinks, so every transition that removes someone from it
 * has to ask `endIfComplete` whether that was the last one.
 */
export declare function inPlayPlayers(state: GameState): PlayerState[];
/**
 * End the game if at most one player is still in play, awarding the last one
 * standing the final placement. Returns true when it ended the game.
 *
 * Counting a departed player as still racing is what let an abandoned table run
 * forever: the finish check never got down to one remaining player, while
 * `advanceTurn` — which does skip leavers — had nobody legal to hand the turn
 * to and left it parked on a player who was already done. The turn clock then
 * expired forever with no state that could ever satisfy the finish check.
 * Mutates the passed (already-cloned) state.
 */
export declare function endIfComplete(state: GameState): boolean;
/**
 * Hand the turn on, or end the game if there is nobody left to hand it to.
 * The single exit every turn hand-off goes through, so no path can advance the
 * clock past the last in-play player.
 */
export declare function handOff(state: GameState): void;
/**
 * Advance the clock to the next player in clockwise seat order, resetting the
 * per-turn dice state. Players who already finished all their tokens are
 * skipped (they spectate while the rest play on), as are players who left the
 * game. Mutates the passed (already-cloned) state.
 *
 * Prefer `handOff`: calling this directly on a state with no in-play player
 * leaves the turn where it is.
 */
export declare function advanceTurn(state: GameState): void;
export declare function makeAction(type: LastAction["type"], payload: unknown, now: number | undefined): LastAction;
//# sourceMappingURL=internal.d.ts.map