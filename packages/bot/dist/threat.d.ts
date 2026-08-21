/**
 * Capture-risk helpers for the smart policy. Pure functions over the engine's
 * board model, all in ABSOLUTE track space (captures only happen there — yard,
 * home columns and the finish are uncapturable by construction).
 *
 * The dice model is the standard single-die approximation: an opponent token
 * 1–6 cells behind a square hits it with probability 1/6 per roll, so the
 * chance at least one of several stalkers connects is 1 − (5/6)^n. Home-column
 * diverts en route are ignored — close enough for move ranking.
 *
 * Two shapes for every question. The plain functions (threatProb, captureProb)
 * take a state and answer about one square; the `*From` variants take a
 * {@link TrackIndex} built once for the whole position. They are the same
 * arithmetic — the difference is where the scan over tokens happens.
 *
 * That matters because evaluate.ts asks these questions at every leaf of the
 * search, once per token per player. Re-deriving "who is standing where" inside
 * each of those calls turned the contact math into the most expensive thing in
 * the search; building it once per position and reading it O(1) is what keeps
 * both the risk term and the hunt term affordable.
 */
import { type GameState, type TokenPosition } from "@ludo/engine";
/**
 * Where everybody is standing, in absolute track space.
 *
 * Parallel arrays rather than a Map: there are at most four players, so a
 * linear scan beats hashing, and this is allocated once per evaluated position
 * in the hot path. Duplicates are kept — a cell appearing twice in a player's
 * list IS a protected stack, which is how {@link stackedIn} reads them without
 * touching the token list again.
 */
export interface TrackIndex {
    ids: readonly string[];
    cells: readonly (readonly number[])[];
}
/** Index every token that is actually on the shared track. */
export declare function buildTrackIndex(state: GameState): TrackIndex;
/**
 * This player's position in the index, or -1 if they have nothing on the track.
 *
 * Callers in the hot path resolve their slot ONCE and pass the number around,
 * which is the difference between one string lookup per evaluated position and
 * one per token per player per leaf.
 */
export declare function slotOf(index: TrackIndex, playerId: string): number;
/** The cells at `slot`; empty for -1. */
export declare function cellsAt(index: TrackIndex, slot: number): readonly number[];
/**
 * Probability that an opponent's next roll captures a token of `playerId`
 * sitting at `pos`. 0 off the shared track and on safe squares.
 */
export declare function threatProb(state: GameState, playerId: string, pos: TokenPosition): number;
/** {@link threatProb} against a prebuilt index, for the owner at `ownerSlot`. */
export declare function threatProbFrom(state: GameState, index: TrackIndex, ownerSlot: number, pos: TokenPosition): number;
/** {@link threatProb} with the owner's slot and absolute cell already known. */
export declare function threatProbAt(state: GameState, index: TrackIndex, ownerSlot: number, abs: number): number;
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
/**
 * Probability that `hunter`'s next roll captures the token `victim` has at
 * `pos`. The exact mirror of {@link threatProb} — same single-die model, same
 * exemptions for safe cells and protected stacks — read from the other side of
 * the board.
 *
 * threatProb answers "what am I about to lose"; this answers "what can I take".
 * A position evaluator needs both, and having only the first is what makes a
 * bot play like it is running a race with the other seats as scenery: it will
 * happily take a capture that falls into its lap, and will never once line one
 * up.
 */
export declare function captureProb(state: GameState, hunter: string, victim: string, pos: TokenPosition): number;
/**
 * {@link captureProb} against a prebuilt index.
 *
 * Checks run cheapest-first, and the range test comes before the exemptions on
 * purpose: most opponent tokens are nowhere near a shooter, so the common path
 * is a handful of subtractions and an early return. Only a token actually under
 * the gun pays for the safe-square and stack lookups.
 */
export declare function captureProbFrom(state: GameState, index: TrackIndex, hunterSlot: number, victim: string, pos: TokenPosition): number;
/**
 * {@link captureProb} with everything already resolved: both slots, and the
 * victim's absolute cell.
 *
 * This is the innermost form, and the evaluator calls it once per token per
 * rival at every leaf — so it deliberately takes what the caller already has
 * rather than re-deriving it. The range test comes first for the same reason:
 * most tokens are nowhere near a shooter, so the common path is a handful of
 * subtractions and an early return, and only a token actually under the gun
 * pays for the safe-square and stack checks.
 */
export declare function captureProbAt(state: GameState, index: TrackIndex, hunterSlot: number, victimSlot: number, abs: number): number;
//# sourceMappingURL=threat.d.ts.map