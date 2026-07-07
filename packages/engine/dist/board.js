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
import { COLOR_ORDER } from "./types.js";
/** Number of cells on the shared loop. */
export const MAIN_TRACK_SIZE = 52;
/** Cells a token traverses on the shared loop before diverting home (relIndex 0..50). */
export const TRACK_PATH_LENGTH = 51;
/** Colored cells in a home column (relIndex 51..55 → homePath index 0..4). */
export const HOME_COLUMN_SIZE = 5;
/** Relative index of the center / finish cell. */
export const FINISH_REL_INDEX = TRACK_PATH_LENGTH + HOME_COLUMN_SIZE; // 56
/** Absolute track index of each color's start (colored) cell. Seats sit 13 apart. */
export const START_OFFSET = {
    red: 0,
    green: 13,
    yellow: 26,
    blue: 39,
};
/**
 * Absolute track indices that are "safe": the 4 colored start cells plus the 4
 * star cells (8 cells past each start). No capture happens here.
 */
export const SAFE_SQUARES = new Set([
    0, 8, 13, 21, 26, 34, 39, 47,
]);
export const TOKENS_PER_PLAYER = 4;
export function isSafeSquare(absoluteTrackIndex) {
    return SAFE_SQUARES.has(absoluteTrackIndex);
}
/** Next color in clockwise turn order. */
export function nextColor(color) {
    const i = COLOR_ORDER.indexOf(color);
    return COLOR_ORDER[(i + 1) % COLOR_ORDER.length];
}
/**
 * Current relative index of a token, or `null` if it is still in the yard.
 * `"finished"` → {@link FINISH_REL_INDEX}.
 */
export function toRelativeIndex(color, position) {
    if (position === "home")
        return null;
    if (position === "finished")
        return FINISH_REL_INDEX;
    if (position.type === "homePath")
        return TRACK_PATH_LENGTH + position.index;
    // track: invert the absolute index back into this color's 0..50 range.
    return (position.index - START_OFFSET[color] + MAIN_TRACK_SIZE) % MAIN_TRACK_SIZE;
}
/**
 * Convert a relative index back into a board position. Inverse of
 * {@link toRelativeIndex} for indices a token can legally occupy (0..56).
 */
export function fromRelativeIndex(color, relIndex) {
    if (relIndex >= FINISH_REL_INDEX)
        return "finished";
    if (relIndex >= TRACK_PATH_LENGTH) {
        return { type: "homePath", index: relIndex - TRACK_PATH_LENGTH };
    }
    return { type: "track", index: (START_OFFSET[color] + relIndex) % MAIN_TRACK_SIZE };
}
/**
 * Absolute track index a token occupies, or `null` if it is not on the shared
 * track (yard, home column, or finished). Used for capture and safe-cell checks.
 */
export function absoluteTrackIndex(position) {
    return typeof position === "object" && position.type === "track" ? position.index : null;
}
//# sourceMappingURL=board.js.map