import { type GameState, type PlayerInput, type RuleConfig } from "./types.js";
export interface CreateGameOptions {
    gameId?: string;
    rules?: Partial<RuleConfig>;
    now?: number;
}
/**
 * Build the initial, ready-to-play {@link GameState} for 2–4 players.
 *
 * Colors are taken from each player's input or auto-assigned in clockwise
 * {@link COLOR_ORDER}. Every player starts with {@link TOKENS_PER_PLAYER} tokens
 * in the yard. The first player is on the clock awaiting their roll.
 */
export declare function createGame(players: PlayerInput[], options?: CreateGameOptions): GameState;
//# sourceMappingURL=createGame.d.ts.map