import { advanceTurn, cloneState, makeAction } from "./internal.js";
/**
 * Force the current turn to end and hand off to the next player, regardless of
 * phase — used for a timed-out turn (the player never rolled, or rolled and
 * never chose a move). Unlike `endTurn`, this makes no legality guarantees: it
 * always advances. Pure: returns a new state.
 *
 * A no-op-shaped call on a finished game throws, matching the other transitions.
 */
export function skipTurn(state, options = {}) {
    if (state.status !== "active") {
        throw new Error(`Cannot skip turn: game is not active (status: ${state.status}).`);
    }
    const next = cloneState(state);
    next.lastAction = makeAction("endTurn", { playerId: state.currentTurnPlayerId, skipped: true }, options.now);
    advanceTurn(next);
    return next;
}
//# sourceMappingURL=skipTurn.js.map