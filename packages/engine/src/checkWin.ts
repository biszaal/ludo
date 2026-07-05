import type { GameState } from "./types.js";
import { hasPlayerWon } from "./internal.js";

export interface WinResult {
  finished: boolean;
  winnerPlayerId?: string;
}

/**
 * Determine whether the game has a winner. A player wins once all of their
 * tokens are `"finished"`. Derived from token positions so it is correct even
 * for an externally-supplied state.
 */
export function checkWin(state: GameState): WinResult {
  if (state.winnerPlayerId) {
    return { finished: true, winnerPlayerId: state.winnerPlayerId };
  }
  for (const player of state.players) {
    if (hasPlayerWon(state, player.id)) {
      return { finished: true, winnerPlayerId: player.id };
    }
  }
  return { finished: false };
}
