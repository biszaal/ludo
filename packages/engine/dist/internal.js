/**
 * Internal helpers shared by the transition functions. Not part of the public
 * API. All functions here are pure and never mutate their inputs.
 */
import { COLOR_ORDER } from "./types.js";
/** Structured clone of a game state, safe to mutate locally before returning. */
export function cloneState(state) {
    return {
        ...state,
        players: state.players.map((p) => ({ ...p })),
        tokens: state.tokens.map((t) => ({ ...t, position: clonePosition(t.position) })),
        rules: { ...state.rules },
        lastAction: state.lastAction ? { ...state.lastAction } : null,
    };
}
function clonePosition(position) {
    return typeof position === "object" ? { ...position } : position;
}
export function getPlayer(state, playerId) {
    const player = state.players.find((p) => p.id === playerId);
    if (!player)
        throw new Error(`Unknown player: ${playerId}.`);
    return player;
}
export function getCurrentPlayer(state) {
    return getPlayer(state, state.currentTurnPlayerId);
}
export function getPlayerTokens(state, playerId) {
    return state.tokens.filter((t) => t.playerId === playerId);
}
export function getToken(state, tokenId) {
    return state.tokens.find((t) => t.id === tokenId);
}
/** True if all of a player's tokens have finished. */
export function hasPlayerWon(state, playerId) {
    const tokens = getPlayerTokens(state, playerId);
    return tokens.length > 0 && tokens.every((t) => t.position === "finished");
}
/**
 * Advance the clock to the next player in clockwise seat order, resetting the
 * per-turn dice state. Mutates the passed (already-cloned) state.
 */
export function advanceTurn(state) {
    const order = state.players
        .slice()
        .sort((a, b) => COLOR_ORDER.indexOf(a.color) - COLOR_ORDER.indexOf(b.color));
    const currentIdx = order.findIndex((p) => p.id === state.currentTurnPlayerId);
    const next = order[(currentIdx + 1) % order.length];
    state.currentTurnPlayerId = next.id;
    state.phase = "awaiting-roll";
    state.diceValue = null;
    state.consecutiveSixes = 0;
}
export function makeAction(type, payload, now) {
    return { type, payload, timestamp: now ?? 0 };
}
//# sourceMappingURL=internal.js.map