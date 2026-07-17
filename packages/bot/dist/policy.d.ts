/**
 * Heuristic move-selection policy. Pure: given a state and the engine's own list
 * of valid moves, pick one. Reusable on client (fill empty seats) and server.
 *
 * Two brains behind one signature:
 * - "easy": the original tiered ladder — capture > finish > advance the token
 *   closest to finishing > leave the yard.
 * - "normal"/"hard" (default "hard"): a weighted score that also weighs capture
 *   RISK — escaping threatened tokens, not landing in an opponent's reach,
 *   grabbing safe squares — and, on hard, hunting prey and camping stars in
 *   ambush of traffic approaching from behind.
 */
import { type GameState, type Move } from "@ludo/engine";
export type BotDifficulty = "easy" | "normal" | "hard";
export interface BotOptions {
    /** Randomness for breaking ties between equally-ranked moves. */
    rng?: () => number;
    /** Strength of play; defaults to "hard". */
    difficulty?: BotDifficulty;
}
/**
 * Choose a move for `playerId` from `validMoves` (which must be the engine's
 * valid moves for that player). Throws if `validMoves` is empty.
 */
export declare function chooseMove(state: GameState, playerId: string, validMoves: Move[], options?: BotOptions): Move;
//# sourceMappingURL=policy.d.ts.map