/**
 * Heuristic move-selection policy. Pure: given a state and the engine's own list
 * of valid moves, pick one. Reusable on client (fill empty seats) and server.
 *
 * Priority (per the spec): capture an opponent > advance the token closest to
 * finishing > move a token out of the yard > random valid move.
 */
import { type GameState, type Move } from "@ludo/engine";
export interface BotOptions {
    /** Randomness for breaking ties between equally-ranked moves. */
    rng?: () => number;
}
/**
 * Choose a move for `playerId` from `validMoves` (which must be the engine's
 * valid moves for that player). Throws if `validMoves` is empty.
 */
export declare function chooseMove(state: GameState, playerId: string, validMoves: Move[], options?: BotOptions): Move;
//# sourceMappingURL=policy.d.ts.map