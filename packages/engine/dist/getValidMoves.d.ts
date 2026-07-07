import type { GameState, Move } from "./types.js";
/**
 * All legal moves for `playerId` given the current dice. Returns `[]` when it is
 * not the player's turn, no dice has been rolled, or the player is blocked — in
 * which case the caller ends the turn.
 *
 * Each entry is fully resolved (destination + captures + finish flag) so the UI
 * can preview outcomes and {@link applyMove} can be fed back verbatim.
 */
export declare function getValidMoves(state: GameState, playerId: string): Move[];
//# sourceMappingURL=getValidMoves.d.ts.map