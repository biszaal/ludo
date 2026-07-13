import type { GameState, TransitionOptions } from "./types.js";
/**
 * A player leaves an active game for good (explicit leave, or their app stayed
 * closed past the idle limit). Their tokens are removed from the board, so
 * they no longer block cells or soak up captures; the turn clock skips them
 * from now on. If only one in-play player remains, the game ends — that player
 * is appended to `finishedOrder`, completing the standings.
 *
 * A player who already finished keeps their tokens and rank — leaving as a
 * spectator only flags the seat. Idempotent: leaving twice is a no-op.
 * Pure: returns a new state.
 */
export declare function leaveGame(state: GameState, playerId: string, options?: TransitionOptions): GameState;
//# sourceMappingURL=leaveGame.d.ts.map