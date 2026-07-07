/**
 * Board geometry and the relative-index path model.
 *
 * Movement math is done in a per-color RELATIVE index so the rules never depend
 * on rendering. Pixel coordinates live only in the app.
 *
 *   relIndex  0 .. 50  → shared main track (51 cells), mapped to an ABSOLUTE
 *                        track index via the color's start offset (mod 52).
 *   relIndex 51 .. 55  → this color's private home column (5 colored cells).
 *   relIndex      56   → the center: `"finished"`.
 *
 * A token leaves the yard onto relIndex 0 (its colored start cell) and must
 * travel 56 steps to finish. Two colors never share a home-column cell, so
 * captures only ever happen in absolute track space.
 */
import type { Color, TokenPosition } from "./types.js";
/** Number of cells on the shared loop. */
export declare const MAIN_TRACK_SIZE = 52;
/** Cells a token traverses on the shared loop before diverting home (relIndex 0..50). */
export declare const TRACK_PATH_LENGTH = 51;
/** Colored cells in a home column (relIndex 51..55 → homePath index 0..4). */
export declare const HOME_COLUMN_SIZE = 5;
/** Relative index of the center / finish cell. */
export declare const FINISH_REL_INDEX: number;
/** Absolute track index of each color's start (colored) cell. Seats sit 13 apart. */
export declare const START_OFFSET: Record<Color, number>;
/**
 * Absolute track indices that are "safe": the 4 colored start cells plus the 4
 * star cells (8 cells past each start). No capture happens here.
 */
export declare const SAFE_SQUARES: ReadonlySet<number>;
export declare const TOKENS_PER_PLAYER = 4;
export declare function isSafeSquare(absoluteTrackIndex: number): boolean;
/** Next color in clockwise turn order. */
export declare function nextColor(color: Color): Color;
/**
 * Current relative index of a token, or `null` if it is still in the yard.
 * `"finished"` → {@link FINISH_REL_INDEX}.
 */
export declare function toRelativeIndex(color: Color, position: TokenPosition): number | null;
/**
 * Convert a relative index back into a board position. Inverse of
 * {@link toRelativeIndex} for indices a token can legally occupy (0..56).
 */
export declare function fromRelativeIndex(color: Color, relIndex: number): TokenPosition;
/**
 * Absolute track index a token occupies, or `null` if it is not on the shared
 * track (yard, home column, or finished). Used for capture and safe-cell checks.
 */
export declare function absoluteTrackIndex(position: TokenPosition): number | null;
//# sourceMappingURL=board.d.ts.map