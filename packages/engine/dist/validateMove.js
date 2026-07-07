import { getValidMoves } from "./getValidMoves.js";
/**
 * Check whether `move` (identified by its `tokenId`) is legal in `state`.
 *
 * Only the `tokenId` is trusted; the destination and captures are recomputed
 * from the engine's own {@link getValidMoves}, so a tampered client `to`/
 * `captures` can never take effect. {@link applyMove} relies on this.
 */
export function validateMove(state, move) {
    if (state.status !== "active") {
        return { valid: false, reason: `Game is not active (status: ${state.status}).` };
    }
    if (state.phase !== "awaiting-move" || state.diceValue === null) {
        return { valid: false, reason: "No dice has been rolled; nothing to move." };
    }
    const token = state.tokens.find((t) => t.id === move.tokenId);
    if (!token) {
        return { valid: false, reason: `Unknown token: ${move.tokenId}.` };
    }
    if (token.playerId !== state.currentTurnPlayerId) {
        return { valid: false, reason: "Token does not belong to the current player." };
    }
    const resolved = getValidMoves(state, state.currentTurnPlayerId).find((m) => m.tokenId === move.tokenId);
    if (!resolved) {
        return { valid: false, reason: `Token ${move.tokenId} has no legal move with a ${state.diceValue}.` };
    }
    return { valid: true, resolved };
}
//# sourceMappingURL=validateMove.js.map