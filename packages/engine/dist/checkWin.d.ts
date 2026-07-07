import type { GameState } from "./types.js";
export interface WinResult {
    finished: boolean;
    winnerPlayerId?: string;
}
/**
 * Determine whether the game has a winner. A player wins once all of their
 * tokens are `"finished"`. Derived from token positions so it is correct even
 * for an externally-supplied state.
 */
export declare function checkWin(state: GameState): WinResult;
//# sourceMappingURL=checkWin.d.ts.map