/**
 * Pure view projection over an authoritative online GameState: what the die
 * shows, the status line, and the local player's highlightable moves. Kept out
 * of the store so the mapping is unit-testable.
 */

import {
  checkWin,
  getValidMoves,
  type Color as PlayerColor,
  type GameState,
  type Move,
} from "@ludo/engine";
import { ordinal } from "./standings";

const COLOR_LABEL: Record<PlayerColor, string> = {
  red: "Red",
  green: "Green",
  yellow: "Yellow",
  blue: "Blue",
};

export interface Projection {
  validMoves: Move[];
  message: string;
  status: "active" | "finished";
  lastRoll: number | null;
}

/**
 * The 6 that forfeited the turn under the three-sixes rule, or null. A busted
 * roll advances the turn and clears diceValue within the same transition, so
 * lastAction is the only place the third six survives — without this the roll
 * never shows on screen and the forfeit looks like it happened a six early.
 */
export function bustedRollDice(state: GameState): number | null {
  if (state.lastAction?.type !== "roll") return null;
  const payload = state.lastAction.payload as { dice?: number; busted?: boolean } | null;
  return payload?.busted ? (payload.dice ?? 6) : null;
}

/**
 * How long the third six stays on screen before the turn actually changes hands.
 *
 * Long enough to read the face after the ~700ms tumble settles. The forfeit is
 * the harshest thing the rules do to a player, and it should be something they
 * watch happen rather than something they infer afterwards.
 */
export const BUST_HOLD_MS = 1400;

/**
 * Is `next` the hand-off that a busted third six caused?
 *
 * rollDice bundles the bust and the hand-off into ONE transition: it stamps
 * lastAction, then calls advanceTurn, which clears diceValue and moves
 * currentTurnPlayerId on. So by the time this state reaches a client, the six
 * has no die to appear on and the seat has already changed — and since the
 * board only draws a die beside the ACTIVE player, the 6 flashes at the next
 * player's corner, as though they rolled it.
 */
export function isBustHandoff(prev: GameState, next: GameState): boolean {
  return (
    prev.gameId === next.gameId &&
    bustedRollDice(next) !== null &&
    prev.currentTurnPlayerId !== next.currentTurnPlayerId
  );
}

// How the hold is painted: the store simply DOESN'T apply the busted state
// yet. The previous state stays on screen, so the roller is still the current
// player and the die still sits at their corner; `lastRoll` carries the six and
// a `bustHold` flag freezes input until the real state lands.
//
// Deliberately not done by synthesising a state like
// `{ ...prev, diceValue: 6, phase: "awaiting-move" }`. That reads fine but is a
// lie the engine can be asked to act on: pass() would see awaiting-move with no
// cached moves, call endTurn(), and the engine — recomputing from the six —
// would throw "Cannot end turn while a legal move is available". A display
// concern must never be smuggled into an authoritative state.

/** Map an authoritative GameState to what this client should display. */
export function project(state: GameState, myPlayerId: string | null): Projection {
  const bustedDice = bustedRollDice(state);
  const lastRoll = bustedDice ?? state.diceValue;

  const win = checkWin(state);
  if (win.finished && win.winnerPlayerId) {
    return {
      validMoves: [],
      message: `${COLOR_LABEL[colorOf(state, win.winnerPlayerId)]} wins!`,
      status: "finished",
      lastRoll,
    };
  }
  // Play-to-completion: once I've locked a podium place I spectate the rest.
  const myPlace = myPlayerId
    ? (state.finishedOrder ?? []).indexOf(myPlayerId)
    : -1;
  if (myPlace !== -1) {
    return {
      validMoves: [],
      message: `You finished ${ordinal(myPlace + 1)}! Watching the rest…`,
      status: "active",
      lastRoll,
    };
  }
  const myTurn = state.currentTurnPlayerId === myPlayerId;
  const validMoves =
    myTurn && state.phase === "awaiting-move"
      ? getValidMoves(state, myPlayerId!)
      : [];
  const turnColor = COLOR_LABEL[colorOf(state, state.currentTurnPlayerId)];
  let message: string;
  if (!myTurn) {
    message =
      bustedDice !== null
        ? `Three 6s — turn forfeited. Waiting for ${turnColor}…`
        : `Waiting for ${turnColor}…`;
  } else if (state.phase === "awaiting-roll") {
    message =
      bustedDice !== null
        ? "Three 6s forfeited their turn — your turn, roll"
        : "Your turn — roll";
  } else {
    message =
      validMoves.length === 0 ? "No moves — passing…" : "Choose a token";
  }
  return { validMoves, message, status: "active", lastRoll };
}

export function colorOf(state: GameState, playerId: string): PlayerColor {
  return state.players.find((p) => p.id === playerId)!.color;
}
