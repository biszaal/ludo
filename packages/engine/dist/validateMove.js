import { getValidMoves, heldDie } from "./getValidMoves.js";
/**
 * Check whether `move` (identified by its `tokenId`) is legal in `state`.
 *
 * Only the `tokenId` is trusted; the destination and captures are recomputed
 * from the engine's own {@link getValidMoves}, so a tampered client `to`/
 * `captures` can never take effect. {@link applyMove} relies on this.
 *
 * In a Frenzy game a token always moves on its owner's die; there is no
 * current player to check it against.
 */
export function validateMove(state, move) {
    if (state.status !== "active") {
        return { valid: false, reason: `Game is not active (status: ${state.status}).` };
    }
    if (!state.frenzy && (state.phase !== "awaiting-move" || state.diceValue === null)) {
        return { valid: false, reason: "No dice has been rolled; nothing to move." };
    }
    const token = state.tokens.find((t) => t.id === move.tokenId);
    if (!token) {
        return { valid: false, reason: `Unknown token: ${move.tokenId}.` };
    }
    const mover = state.frenzy ? token.playerId : state.currentTurnPlayerId;
    if (token.playerId !== mover) {
        return { valid: false, reason: "Token does not belong to the current player." };
    }
    const dice = heldDie(state, mover);
    if (dice === null) {
        return { valid: false, reason: "No dice has been rolled; nothing to move." };
    }
    const resolved = getValidMoves(state, mover).find((m) => m.tokenId === move.tokenId);
    if (!resolved) {
        return { valid: false, reason: `Token ${move.tokenId} has no legal move with a ${dice}.` };
    }
    return { valid: true, resolved };
}
//# sourceMappingURL=validateMove.js.map