import { FINISH_REL_INDEX, absoluteTrackIndex, fromRelativeIndex, isSafeSquare, toRelativeIndex, } from "./board.js";
import { getPlayer } from "./internal.js";
/**
 * All legal moves for `playerId` given the current dice. Returns `[]` when it is
 * not the player's turn, no dice has been rolled, or the player is blocked — in
 * which case the caller ends the turn.
 *
 * Each entry is fully resolved (destination + captures + finish flag) so the UI
 * can preview outcomes and {@link applyMove} can be fed back verbatim.
 */
export function getValidMoves(state, playerId) {
    if (state.status !== "active")
        return [];
    if (state.currentTurnPlayerId !== playerId)
        return [];
    if (state.phase !== "awaiting-move" || state.diceValue === null)
        return [];
    const dice = state.diceValue;
    const color = getPlayer(state, playerId).color;
    const tokens = state.tokens.filter((t) => t.playerId === playerId);
    const moves = [];
    for (const token of tokens) {
        const move = resolveMove(state, token, color, dice);
        if (move)
            moves.push(move);
    }
    return moves;
}
/** Resolve the single move a token can make with `dice`, or null if it cannot move. */
function resolveMove(state, token, color, dice) {
    if (token.position === "finished")
        return null;
    const relIndex = toRelativeIndex(color, token.position);
    // In the yard: leave only under the leave-yard rule, landing on the start cell.
    if (relIndex === null) {
        const canLeave = dice === 6 || !state.rules.leaveYardOnSix;
        if (!canLeave)
            return null;
        const to = fromRelativeIndex(color, 0);
        return buildMove(state, token, color, to);
    }
    const destRel = relIndex + dice;
    if (destRel > FINISH_REL_INDEX) {
        // Overshoots the center.
        if (state.rules.exactRollToFinish)
            return null;
        return buildMove(state, token, color, "finished");
    }
    const to = fromRelativeIndex(color, destRel);
    return buildMove(state, token, color, to);
}
/**
 * Attach capture/finish metadata to a candidate destination, or null when the
 * destination is barred — today only by an opponent's protected stack.
 */
function buildMove(state, token, color, to) {
    const destAbs = absoluteTrackIndex(to);
    if (destAbs !== null && isBlockedByStack(state, token.playerId, destAbs))
        return null;
    const captures = destAbs === null ? [] : computeCaptures(state, token.playerId, destAbs);
    return {
        tokenId: token.id,
        from: token.position,
        to,
        captures,
        finishes: to === "finished",
    };
}
/** Opponent tokens sitting on `absIndex`, grouped by owner. */
function opponentsOn(state, moverPlayerId, absIndex) {
    const byOwner = new Map();
    for (const t of state.tokens) {
        if (t.playerId === moverPlayerId)
            continue;
        if (absoluteTrackIndex(t.position) !== absIndex)
            continue;
        const owned = byOwner.get(t.playerId);
        if (owned)
            owned.push(t.id);
        else
            byOwner.set(t.playerId, [t.id]);
    }
    return byOwner;
}
/**
 * Is landing on `absIndex` barred by a protected stack?
 *
 * A stack is two or more tokens of the SAME opponent on one cell — they guard
 * each other, so the move has to be played with a different token. Two
 * different opponents each holding one token there is not a stack: neither is
 * protected and both are captured, as before.
 *
 * Safe squares are exempt on purpose. Nothing is capturable there anyway, and
 * barring the landing would let a pair of tokens parked on a start cell lock
 * their owner out of leaving the yard.
 */
function isBlockedByStack(state, moverPlayerId, absIndex) {
    if (!state.rules.protectStacks)
        return false;
    if (state.rules.safeSquares && isSafeSquare(absIndex))
        return false;
    for (const ids of opponentsOn(state, moverPlayerId, absIndex).values()) {
        if (ids.length >= 2)
            return true;
    }
    return false;
}
/**
 * Ids of opponent tokens sent home by landing on `absIndex`. None on safe
 * squares, and none from a protected stack — {@link isBlockedByStack} has
 * already rejected that destination, so anything reaching here is a lone token.
 */
function computeCaptures(state, moverPlayerId, absIndex) {
    if (state.rules.safeSquares && isSafeSquare(absIndex))
        return [];
    const byOwner = opponentsOn(state, moverPlayerId, absIndex);
    const captured = [];
    for (const ids of byOwner.values()) {
        if (state.rules.protectStacks && ids.length >= 2)
            continue;
        captured.push(...ids);
    }
    return captured;
}
//# sourceMappingURL=getValidMoves.js.map