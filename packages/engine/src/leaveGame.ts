import type { GameState, TransitionOptions } from "./types.js";
import { advanceTurn, cloneState, endIfComplete, getPlayer, makeAction } from "./internal.js";

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
export function leaveGame(state: GameState, playerId: string, options: TransitionOptions = {}): GameState {
  if (state.status !== "active") {
    throw new Error(`Cannot leave: game is not active (status: ${state.status}).`);
  }
  const player = getPlayer(state, playerId);
  if (player.hasLeft) return cloneState(state);

  const next = cloneState(state);
  const me = next.players.find((p) => p.id === playerId)!;
  me.hasLeft = true;
  me.isConnected = false;
  next.lastAction = makeAction("leave", { playerId }, options.now);

  const alreadyPlaced = next.finishedOrder.includes(playerId);
  if (!alreadyPlaced) {
    // Clear the leaver off the board. Finished players keep their tokens
    // (all in the center) and their placement.
    next.tokens = next.tokens.filter((t) => t.playerId !== playerId);
  }

  // Last opponent standing inherits the next placement and the game ends.
  if (endIfComplete(next)) return next;

  // If the leaver held the turn, hand it to the next player still in play.
  if (next.currentTurnPlayerId === playerId) {
    advanceTurn(next);
  }
  return next;
}
