import type { GameState, Move } from "./types.js";
export interface ValidationResult {
    valid: boolean;
    reason?: string;
    /** The canonical, engine-computed move for this token (authoritative source). */
    resolved?: Move;
}
/**
 * Check whether `move` (identified by its `tokenId`) is legal in `state`.
 *
 * Only the `tokenId` is trusted; the destination and captures are recomputed
 * from the engine's own {@link getValidMoves}, so a tampered client `to`/
 * `captures` can never take effect. {@link applyMove} relies on this.
 */
export declare function validateMove(state: GameState, move: Pick<Move, "tokenId">): ValidationResult;
//# sourceMappingURL=validateMove.d.ts.map