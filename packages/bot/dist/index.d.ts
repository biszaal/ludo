/**
 * @ludo/bot — Ludo move selection over the engine's API. A tiered heuristic
 * ladder plus, at the top tier, a one-ply expectimax search.
 */
export { chooseMove, type BotOptions, type BotDifficulty } from "./policy.js";
export { threatProb, chaseCount, opponentsBehind } from "./threat.js";
export { evaluateFor, riskAppetite, tokenProgressValue } from "./evaluate.js";
export { scoreMoves, type ScoredMove } from "./search.js";
//# sourceMappingURL=index.d.ts.map