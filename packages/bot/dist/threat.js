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
import { absoluteTrackIndex, isSafeSquare, MAIN_TRACK_SIZE, } from "@ludo/engine";
/** Is `abs` a cell where the rules forbid capture? */
function safeCell(state, abs) {
    return state.rules.safeSquares && isSafeSquare(abs);
}
/**
 * Does `owner` have a protected stack on `abs`? Two of their tokens sharing a
 * cell guard each other, so the square is as good as a star for them — neither
 * a threat to model nor prey worth chasing.
 */
function stackedAt(state, owner, abs) {
    if (!state.rules.protectStacks)
        return false;
    let n = 0;
    for (const t of state.tokens) {
        if (t.playerId !== owner)
            continue;
        if (absoluteTrackIndex(t.position) !== abs)
            continue;
        if (++n >= 2)
            return true;
    }
    return false;
}
/** Opponent track tokens of `playerId` (the only pieces that threaten or flee). */
function opponentTrackTokens(state, playerId) {
    const out = [];
    for (const t of state.tokens) {
        if (t.playerId === playerId)
            continue;
        const abs = absoluteTrackIndex(t.position);
        if (abs !== null)
            out.push({ abs, owner: t.playerId });
    }
    return out;
}
/**
 * Probability that an opponent's next roll captures a token of `playerId`
 * sitting at `pos`. 0 off the shared track and on safe squares.
 */
export function threatProb(state, playerId, pos) {
    const abs = absoluteTrackIndex(pos);
    if (abs === null || safeCell(state, abs))
        return 0;
    // Standing on our own stack is as good as a star — nobody can land here.
    if (stackedAt(state, playerId, abs))
        return 0;
    let missAll = 1;
    for (const opp of opponentTrackTokens(state, playerId)) {
        const dist = (abs - opp.abs + MAIN_TRACK_SIZE) % MAIN_TRACK_SIZE;
        if (dist >= 1 && dist <= 6)
            missAll *= 5 / 6;
    }
    return 1 - missAll;
}
/**
 * Capturable opponent tokens within one roll AHEAD of `pos` — prey a token
 * standing there could hunt next turn. Tokens parked on safe squares don't
 * count, and neither do stacked ones; both are untakeable.
 */
export function chaseCount(state, playerId, pos) {
    const abs = absoluteTrackIndex(pos);
    if (abs === null)
        return 0;
    let n = 0;
    for (const opp of opponentTrackTokens(state, playerId)) {
        const dist = (opp.abs - abs + MAIN_TRACK_SIZE) % MAIN_TRACK_SIZE;
        if (dist < 1 || dist > 6)
            continue;
        if (safeCell(state, opp.abs) || stackedAt(state, opp.owner, opp.abs))
            continue;
        n++;
    }
    return n;
}
/**
 * Opponent track tokens within `range` cells BEHIND `pos` — traffic that must
 * file past this square soon. A token camped on a safe cell here sits in
 * ambush: the passers-by land in its capture range while it risks nothing.
 */
export function opponentsBehind(state, playerId, pos, range) {
    const abs = absoluteTrackIndex(pos);
    if (abs === null)
        return 0;
    let n = 0;
    for (const opp of opponentTrackTokens(state, playerId)) {
        const dist = (abs - opp.abs + MAIN_TRACK_SIZE) % MAIN_TRACK_SIZE;
        if (dist >= 1 && dist <= range)
            n++;
    }
    return n;
}
//# sourceMappingURL=threat.js.map