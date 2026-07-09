import {
  COLOR_ORDER,
  DEFAULT_RULES,
  type Color,
  type GameState,
  type PlayerInput,
  type PlayerState,
  type RuleConfig,
  type Token,
} from "./types.js";
import { TOKENS_PER_PLAYER } from "./board.js";

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
export function createGame(players: PlayerInput[], options: CreateGameOptions = {}): GameState {
  if (players.length < 2 || players.length > 4) {
    throw new Error(`Ludo supports 2–4 players, received ${players.length}.`);
  }

  const assignedColors = assignColors(players);

  const playerStates: PlayerState[] = players.map((p, i) => ({
    id: p.id,
    userId: p.userId,
    color: assignedColors[i]!,
    isConnected: p.isConnected ?? true,
  }));

  const tokens: Token[] = playerStates.flatMap((player) =>
    Array.from({ length: TOKENS_PER_PLAYER }, (_unused, i): Token => ({
      id: `${player.color}-${i}`,
      playerId: player.id,
      color: player.color,
      position: "home",
    })),
  );

  return {
    gameId: options.gameId ?? `game-${players.map((p) => p.id).join("-")}`,
    status: "active",
    players: playerStates,
    currentTurnPlayerId: playerStates[0]!.id,
    phase: "awaiting-roll",
    diceValue: null,
    consecutiveSixes: 0,
    tokens,
    rules: { ...DEFAULT_RULES, ...options.rules },
    winnerPlayerId: null,
    finishedOrder: [],
    lastAction: { type: "createGame", payload: { players: playerStates.length }, timestamp: options.now ?? 0 },
  };
}

/** Resolve a color for each player, honoring explicit choices and filling gaps. */
function assignColors(players: PlayerInput[]): Color[] {
  const used = new Set<Color>();
  for (const p of players) {
    if (p.color) {
      if (used.has(p.color)) {
        throw new Error(`Duplicate color assignment: ${p.color}.`);
      }
      used.add(p.color);
    }
  }
  const available = COLOR_ORDER.filter((c) => !used.has(c));
  let next = 0;
  return players.map((p) => p.color ?? available[next++]!);
}
