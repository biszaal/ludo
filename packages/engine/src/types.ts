/**
 * Core data model for the Ludo engine.
 *
 * The {@link GameState} is the canonical, serializable source of truth. It is
 * stored verbatim as JSONB in Supabase and rehydrated by clients. Every engine
 * function is a pure transition `GameState -> GameState` (plus, for the dice, an
 * injected randomness source), so the same code runs on client and server.
 */

export type Color = "red" | "green" | "yellow" | "blue";

/** Turn order, clockwise. Colors are assigned to seats in this order. */
export const COLOR_ORDER: readonly Color[] = ["red", "green", "yellow", "blue"];

/**
 * Where a single token sits. Mirrors the spec's contract exactly so the shape is
 * stable across the wire:
 * - `"home"`     — in the yard, not yet on the board.
 * - `track`      — on a shared main-track cell, addressed by ABSOLUTE index 0..51.
 * - `homePath`   — in this color's private home column, index 0..4.
 * - `"finished"` — reached the center; out of play and counts toward winning.
 */
export type TokenPosition =
  | "home"
  | "finished"
  | { type: "track"; index: number }
  | { type: "homePath"; index: number };

export interface Token {
  /** Stable id, e.g. `"red-0"`. */
  id: string;
  /** Owning player's id (see {@link PlayerState.id}). */
  playerId: string;
  /** Denormalized owner color — equals the owning player's color. */
  color: Color;
  position: TokenPosition;
}

export interface PlayerState {
  /** Id of the player WITHIN this game (seat id), distinct from userId. */
  id: string;
  /** External account id (Supabase auth user). */
  userId: string;
  color: Color;
  isConnected: boolean;
}

/** Minimal input accepted by {@link createGame}. Color is auto-assigned if absent. */
export interface PlayerInput {
  id: string;
  userId: string;
  color?: Color;
  isConnected?: boolean;
}

export type GameStatus = "waiting" | "active" | "finished";

/**
 * Two-phase turn machine:
 * - `awaiting-roll` — the current player must roll the dice next.
 * - `awaiting-move` — the dice is shown; the player must apply a move (or, if
 *   there are no legal moves, the caller ends the turn).
 */
export type Phase = "awaiting-roll" | "awaiting-move";

/** A fully-resolved legal move, as returned by {@link getValidMoves}. */
export interface Move {
  tokenId: string;
  from: TokenPosition;
  to: TokenPosition;
  /** Opponent token ids this move sends back to their yard. */
  captures: string[];
  /** True if the moving token reaches `"finished"`. */
  finishes: boolean;
}

export interface LastAction {
  type: "createGame" | "roll" | "move" | "endTurn";
  payload: unknown;
  /** Epoch ms. Defaults to 0 inside the pure engine; callers may supply real time. */
  timestamp: number;
}

/**
 * Tunable ruleset. Defaults ({@link DEFAULT_RULES}) implement standard
 * tournament Ludo. Flags exist so the simpler spec-minimal ruleset and future
 * variants remain expressible without forking the engine.
 */
export interface RuleConfig {
  /** A token may leave the yard only on a 6. */
  leaveYardOnSix: boolean;
  /** Rolling a 6 grants another roll. */
  extraTurnOnSix: boolean;
  /** Capturing an opponent grants another roll. */
  extraTurnOnCapture: boolean;
  /** Getting a token to `"finished"` grants another roll. */
  extraTurnOnFinish: boolean;
  /** Three consecutive 6s forfeit the turn (third six is wasted). */
  threeSixesForfeit: boolean;
  /** A token must roll the exact count to land on the center; overshoot is illegal. */
  exactRollToFinish: boolean;
  /** No captures occur on starred safe squares. */
  safeSquares: boolean;
  /** Two same-color tokens form an impassable, capture-proof block. Off in v1. */
  enableBlockades: boolean;
}

export const DEFAULT_RULES: RuleConfig = {
  leaveYardOnSix: true,
  extraTurnOnSix: true,
  extraTurnOnCapture: true,
  extraTurnOnFinish: true,
  threeSixesForfeit: true,
  exactRollToFinish: true,
  safeSquares: true,
  enableBlockades: false,
};

export interface GameState {
  gameId: string;
  status: GameStatus;
  players: PlayerState[];
  currentTurnPlayerId: string;
  phase: Phase;
  /** Result of the most recent roll while in `awaiting-move`; otherwise null. */
  diceValue: number | null;
  /** 6s rolled in a row this turn; drives the three-sixes-forfeit rule. */
  consecutiveSixes: number;
  tokens: Token[];
  rules: RuleConfig;
  winnerPlayerId: string | null;
  lastAction: LastAction | null;
}

/** Options threaded through transitions that would otherwise need wall-clock time. */
export interface TransitionOptions {
  /** Epoch ms recorded on `lastAction`. Defaults to 0 to keep transitions pure. */
  now?: number;
}
