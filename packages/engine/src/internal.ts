/**
 * Internal helpers shared by the transition functions. Not part of the public
 * API. All functions here are pure and never mutate their inputs.
 */

import type { GameState, LastAction, PlayerState, Token } from "./types.js";
import { COLOR_ORDER } from "./types.js";

/** Structured clone of a game state, safe to mutate locally before returning. */
export function cloneState(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p })),
    tokens: state.tokens.map((t) => ({ ...t, position: clonePosition(t.position) })),
    rules: { ...state.rules },
    // `?? []` tolerates states persisted before finishedOrder existed.
    finishedOrder: [...(state.finishedOrder ?? [])],
    lastAction: state.lastAction ? { ...state.lastAction } : null,
  };
}

function clonePosition(position: Token["position"]): Token["position"] {
  return typeof position === "object" ? { ...position } : position;
}

export function getPlayer(state: GameState, playerId: string): PlayerState {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`Unknown player: ${playerId}.`);
  return player;
}

export function getCurrentPlayer(state: GameState): PlayerState {
  return getPlayer(state, state.currentTurnPlayerId);
}

export function getPlayerTokens(state: GameState, playerId: string): Token[] {
  return state.tokens.filter((t) => t.playerId === playerId);
}

export function getToken(state: GameState, tokenId: string): Token | undefined {
  return state.tokens.find((t) => t.id === tokenId);
}

/** True if all of a player's tokens have finished. */
export function hasPlayerWon(state: GameState, playerId: string): boolean {
  const tokens = getPlayerTokens(state, playerId);
  return tokens.length > 0 && tokens.every((t) => t.position === "finished");
}

/**
 * Players still racing: neither placed in `finishedOrder` nor departed.
 *
 * This set only ever shrinks, so every transition that removes someone from it
 * has to ask `endIfComplete` whether that was the last one.
 */
export function inPlayPlayers(state: GameState): PlayerState[] {
  const placed = new Set(state.finishedOrder ?? []);
  return state.players.filter((p) => !p.hasLeft && !placed.has(p.id));
}

/**
 * End the game if at most one player is still in play, awarding the last one
 * standing the final placement. Returns true when it ended the game.
 *
 * Counting a departed player as still racing is what let an abandoned table run
 * forever: the finish check never got down to one remaining player, while
 * `advanceTurn` — which does skip leavers — had nobody legal to hand the turn
 * to and left it parked on a player who was already done. The turn clock then
 * expired forever with no state that could ever satisfy the finish check.
 * Mutates the passed (already-cloned) state.
 */
export function endIfComplete(state: GameState): boolean {
  const inPlay = inPlayPlayers(state);
  if (inPlay.length > 1) return false;

  if (state.finishedOrder == null) state.finishedOrder = [];
  if (inPlay.length === 1) state.finishedOrder.push(inPlay[0]!.id);
  if (!state.winnerPlayerId) state.winnerPlayerId = state.finishedOrder[0] ?? null;
  state.status = "finished";
  state.phase = "awaiting-roll";
  state.diceValue = null;
  state.consecutiveSixes = 0;
  return true;
}

/**
 * Hand the turn on, or end the game if there is nobody left to hand it to.
 * The single exit every turn hand-off goes through, so no path can advance the
 * clock past the last in-play player.
 */
export function handOff(state: GameState): void {
  if (!endIfComplete(state)) advanceTurn(state);
}

/**
 * Advance the clock to the next player in clockwise seat order, resetting the
 * per-turn dice state. Players who already finished all their tokens are
 * skipped (they spectate while the rest play on), as are players who left the
 * game. Mutates the passed (already-cloned) state.
 *
 * Prefer `handOff`: calling this directly on a state with no in-play player
 * leaves the turn where it is.
 */
export function advanceTurn(state: GameState): void {
  const done = new Set([
    ...(state.finishedOrder ?? []),
    ...state.players.filter((p) => p.hasLeft).map((p) => p.id),
  ]);
  const order = state.players
    .slice()
    .sort((a, b) => COLOR_ORDER.indexOf(a.color) - COLOR_ORDER.indexOf(b.color));
  const currentIdx = order.findIndex((p) => p.id === state.currentTurnPlayerId);
  for (let step = 1; step <= order.length; step++) {
    const candidate = order[(currentIdx + step) % order.length]!;
    if (!done.has(candidate.id)) {
      state.currentTurnPlayerId = candidate.id;
      break;
    }
  }
  state.phase = "awaiting-roll";
  state.diceValue = null;
  state.consecutiveSixes = 0;
}

export function makeAction(
  type: LastAction["type"],
  payload: unknown,
  now: number | undefined,
): LastAction {
  return { type, payload, timestamp: now ?? 0 };
}
