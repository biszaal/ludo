/**
 * @ludo/engine — the pure, deterministic Ludo rules engine.
 *
 * The single source of truth for game logic, shared by the mobile client and
 * the Supabase Edge Functions. No UI, no I/O, no runtime dependencies; every
 * export is a pure function of its inputs.
 */
export * from "./types.js";
export { MAIN_TRACK_SIZE, TRACK_PATH_LENGTH, HOME_COLUMN_SIZE, FINISH_REL_INDEX, START_OFFSET, SAFE_SQUARES, TOKENS_PER_PLAYER, isSafeSquare, nextColor, toRelativeIndex, fromRelativeIndex, absoluteTrackIndex, } from "./board.js";
export { createSeededRng, rollDie, mathRandomRng } from "./rng.js";
export { createGame } from "./createGame.js";
export { rollDice } from "./rollDice.js";
export { getValidMoves } from "./getValidMoves.js";
export { validateMove } from "./validateMove.js";
export { applyMove } from "./applyMove.js";
export { endTurn } from "./endTurn.js";
export { skipTurn } from "./skipTurn.js";
export { leaveGame } from "./leaveGame.js";
export { checkWin } from "./checkWin.js";
// Read-only helpers handy for clients/bots projecting the state.
export { getCurrentPlayer, getPlayerTokens, hasPlayerWon, inPlayPlayers } from "./internal.js";
//# sourceMappingURL=index.js.map