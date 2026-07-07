import type { GameState, Move, TransitionOptions } from "./types.js";
/**
 * Apply a legal move and resolve the consequences: token advance, captures,
 * win check, and either a bonus roll or hand-off to the next player.
 *
 * The move is re-validated and re-resolved from `tokenId` against the engine's
 * own rules, so callers cannot smuggle in an illegal destination. Throws if the
 * move is not legal in `state`. Pure: returns a new state, never mutates input.
 */
export declare function applyMove(state: GameState, move: Pick<Move, "tokenId">, options?: TransitionOptions): GameState;
//# sourceMappingURL=applyMove.d.ts.map