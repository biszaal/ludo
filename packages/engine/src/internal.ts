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
 * Advance the clock to the next player in clockwise seat order, resetting the
 * per-turn dice state. Mutates the passed (already-cloned) state.
 */
export function advanceTurn(state: GameState): void {
  const order = state.players
    .slice()
    .sort((a, b) => COLOR_ORDER.indexOf(a.color) - COLOR_ORDER.indexOf(b.color));
  const currentIdx = order.findIndex((p) => p.id === state.currentTurnPlayerId);
  const next = order[(currentIdx + 1) % order.length]!;
  state.currentTurnPlayerId = next.id;
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
