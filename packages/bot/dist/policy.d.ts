/**
 * Heuristic move-selection policy. Pure: given a state and the engine's own list
 * of valid moves, pick one. Reusable on client (fill empty seats) and server.
 *
 * Three brains behind one signature:
 * - "easy": the original tiered ladder — capture > finish > advance the token
 *   closest to finishing > leave the yard.
 * - "normal": a weighted score that also weighs capture RISK — escaping
 *   threatened tokens, not landing in an opponent's reach, grabbing safe
 *   squares — plus hunting prey and camping stars in ambush of traffic
 *   approaching from behind. This was the old "hard".
 * - "hard" (the default): one-ply expectimax. Every candidate is played out,
 *   the next seat's six possible rolls are each answered with their own best
 *   reply, and the resulting positions are valued by evaluate.ts. Leader
 *   targeting, ahead/behind risk appetite and bonus-turn chaining all fall out
 *   of the evaluator rather than being bolted on as rules.
 *
 * The tiers stay because callers still want a weak opponent sometimes; nothing
 * in the codebase asks for one today, but deleting the ladder to add a search
 * would be throwing away the only dial we have.
 */
import { type GameState, type Move } from "@ludo/engine";
export type BotDifficulty = "easy" | "normal" | "hard";
export interface BotOptions {
    /** Randomness for breaking ties between equally-ranked moves. */
    rng?: () => number;
    /** Strength of play; defaults to "hard". */
    difficulty?: BotDifficulty;
    /** Plies of roll-and-reply the "hard" search expands past each candidate.
     *  Defaults to {@link DEFAULT_SEARCH_DEPTH}. Ignored by the other tiers. */
    depth?: number;
}
/**
 * Plies of roll-and-reply "hard" expands past each candidate.
 *
 * Measured over seeded self-play rather than guessed, because the honest answer
 * turned out to be "barely":
 *
 *   depth 2 vs depth 1, heads-up, 700 games ....... 54.0%  (z = 2.1)
 *   depth 2 vs depth 1, one seat in a 4p table .... +0.3pt (1σ = 1.1pt — noise)
 *   cost, 4-player midgame ........................ 948µs vs 162µs per decision
 *
 * So depth 2 is a real but small heads-up edge and an unresolvable one at a
 * full table, bought for 6x the CPU. It stays the default only because the
 * absolute cost is still tiny — ~23ms across a whole 24-action bot run, ~11% of
 * the edge runtime's 200ms soft CPU limit. Depth 3 was abandoned: it could not
 * finish a measurement run in ten minutes.
 *
 * If bot CPU ever needs to come down, dropping to 1 is the cheapest 6x
 * available and costs almost nothing at a 4-player table.
 */
export declare const DEFAULT_SEARCH_DEPTH = 2;
/**
 * Choose a move for `playerId` from `validMoves` (which must be the engine's
 * valid moves for that player). Throws if `validMoves` is empty.
 */
export declare function chooseMove(state: GameState, playerId: string, validMoves: Move[], options?: BotOptions): Move;
//# sourceMappingURL=policy.d.ts.map