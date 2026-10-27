import type { GameState, Move } from "./types.js";
/**
 * All legal moves for `playerId` given the current dice. Returns `[]` when it is
 * not the player's turn, no dice has been rolled, or the player is blocked — in
 * which case the caller ends the turn.
 *
 * In a Frenzy game there is no turn: the player moves on their own die
 * (`state.frenzy.dice[playerId]`), and gets `[]` while it is empty.
 *
 * Each entry is fully resolved (destination + captures + finish flag) so the UI
 * can preview outcomes and {@link applyMove} can be fed back verbatim.
 */
export declare function getValidMoves(state: GameState, playerId: string): Move[];
/** The die `playerId` may move with right now, or null if they have none. */
export declare function heldDie(state: GameState, playerId: string): number | null;
//# sourceMappingURL=getValidMoves.d.ts.map