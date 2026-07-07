/**
 * Core data model for the Ludo engine.
 *
 * The {@link GameState} is the canonical, serializable source of truth. It is
 * stored verbatim as JSONB in Supabase and rehydrated by clients. Every engine
 * function is a pure transition `GameState -> GameState` (plus, for the dice, an
 * injected randomness source), so the same code runs on client and server.
 */
/** Turn order, clockwise. Colors are assigned to seats in this order. */
export const COLOR_ORDER = ["red", "green", "yellow", "blue"];
export const DEFAULT_RULES = {
    leaveYardOnSix: true,
    extraTurnOnSix: true,
    extraTurnOnCapture: true,
    extraTurnOnFinish: true,
    threeSixesForfeit: true,
    exactRollToFinish: true,
    safeSquares: true,
    enableBlockades: false,
};
//# sourceMappingURL=types.js.map