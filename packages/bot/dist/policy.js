/**
 * Heuristic move-selection policy. Pure: given a state and the engine's own list
 * of valid moves, pick one. Reusable on client (fill empty seats) and server.
 *
 * Priority (per the spec): capture an opponent > advance the token closest to
 * finishing > move a token out of the yard > random valid move.
 */
import { toRelativeIndex } from "@ludo/engine";
/**
 * Choose a move for `playerId` from `validMoves` (which must be the engine's
 * valid moves for that player). Throws if `validMoves` is empty.
 */
export function chooseMove(state, playerId, validMoves, options = {}) {
    if (validMoves.length === 0) {
        throw new Error("chooseMove called with no valid moves.");
    }
    if (validMoves.length === 1)
        return validMoves[0];
    const color = state.players.find((p) => p.id === playerId).color;
    const rng = options.rng ?? Math.random;
    let best = [];
    let bestScore = -Infinity;
    for (const move of validMoves) {
        const s = scoreMove(color, move);
        if (s > bestScore) {
            bestScore = s;
            best = [move];
        }
        else if (s === bestScore) {
            best.push(move);
        }
    }
    return best[Math.floor(rng() * best.length)];
}
/**
 * Rank a move. Tiers are spaced far enough apart that a higher-priority concern
 * always outranks a lower one:
 *   captures ≫ finishing ≫ advance-closest-to-finish ≫ leave yard.
 */
function scoreMove(color, move) {
    let score = 0;
    score += move.captures.length * 10_000;
    if (move.finishes)
        score += 5_000;
    if (move.from === "home") {
        score += 100; // leaving the yard, ranked below advancing a token in play
    }
    else {
        // Prefer moving the token nearest the finish (its current progress).
        const progress = toRelativeIndex(color, move.from) ?? 0;
        score += progress * 10;
    }
    return score;
}
//# sourceMappingURL=policy.js.map