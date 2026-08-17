/**
 * Capture-risk helpers for the smart policy. Pure functions over the engine's
 * board model, all in ABSOLUTE track space (captures only happen there — yard,
 * home columns and the finish are uncapturable by construction).
 *
 * The dice model is the standard single-die approximation: an opponent token
 * 1–6 cells behind a square hits it with probability 1/6 per roll, so the
 * chance at least one of several stalkers connects is 1 − (5/6)^n. Home-column
 * diverts en route are ignored — close enough for move ranking.
 */
import { type GameState, type TokenPosition } from "@ludo/engine";
/**
 * Probability that an opponent's next roll captures a token of `playerId`
 * sitting at `pos`. 0 off the shared track and on safe squares.
 */
export declare function threatProb(state: GameState, playerId: string, pos: TokenPosition): number;
/**
 * Capturable opponent tokens within one roll AHEAD of `pos` — prey a token
 * standing there could hunt next turn. Tokens parked on safe squares don't
 * count, and neither do stacked ones; both are untakeable.
 */
export declare function chaseCount(state: GameState, playerId: string, pos: TokenPosition): number;
/**
 * Opponent track tokens within `range` cells BEHIND `pos` — traffic that must
 * file past this square soon. A token camped on a safe cell here sits in
 * ambush: the passers-by land in its capture range while it risks nothing.
 */
export declare function opponentsBehind(state: GameState, playerId: string, pos: TokenPosition, range: number): number;
//# sourceMappingURL=threat.d.ts.map