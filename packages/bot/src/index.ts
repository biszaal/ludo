/**
 * @ludo/bot — heuristic Ludo move-selection policy over the engine's API.
 */

export { chooseMove, type BotOptions, type BotDifficulty } from "./policy.js";
export { threatProb, chaseCount, opponentsBehind } from "./threat.js";
