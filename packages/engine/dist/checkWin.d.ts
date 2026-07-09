import type { GameState } from "./types.js";
export interface WinResult {
    /** True once the whole game is over (only one unfinished player remains). */
    finished: boolean;
    /** First player to get all tokens home — the 1st-place winner. */
    winnerPlayerId?: string;
}
/**
 * Whether the game is over, and who won (finished first). The game plays to
 * completion: one player finishing does NOT end a 3–4 player game — it ends
 * when all but one have finished (the winner is still whoever finished first).
 * Falls back to token-derived checks so it is correct even for an
 * externally-supplied state that never went through applyMove.
 */
export declare function checkWin(state: GameState): WinResult;
//# sourceMappingURL=checkWin.d.ts.map