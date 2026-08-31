import type { GameState, TransitionOptions } from "./types.js";
import { getValidMoves } from "./getValidMoves.js";
import { cloneState, handOff, makeAction } from "./internal.js";

/** Rolls a player with nothing on the board gets to find a six. */
export const YARD_ROLLS = 3;

/**
 * Is this player locked out of the board with pawns still to bring on?
 *
 * BOTH halves are load-bearing, and the second one is not obvious.
 *
 * At least one token must be in the yard, because that is the only thing
 * another roll could achieve. "Nothing on the board" alone also describes a
 * player whose tokens are all FINISHED — and granting them re-rolls is the
 * abandoned-table bug all over again: a seat that is done, cannot act, and
 * would be handed roll after roll instead of letting endIfComplete end the
 * game. That table once wrote 5,567 forced passes; see abandonedTable.test.ts,
 * which is what caught this.
 *
 * And nothing may be in play, because a player with a pawn on the track or in
 * the home column is having an ordinary bad turn, not being locked out.
 */
function stuckInYard(state: GameState, playerId: string): boolean {
  const mine = state.tokens.filter((t) => t.playerId === playerId);
  const waiting = mine.some((t) => t.position === "home");
  const playing = mine.some((t) => t.position !== "home" && t.position !== "finished");
  return waiting && !playing;
}

/**
 * Pass the turn to the next player. Used after a roll that produced no legal
 * moves (a forced pass).
 *
 * Guards against misuse: the player must have already rolled (`awaiting-move`)
 * and must genuinely have no legal move — you cannot skip a turn when a move is
 * available. Pure: returns a new state.
 */
export function endTurn(state: GameState, options: TransitionOptions = {}): GameState {
  if (state.status !== "active") {
    throw new Error(`Cannot end turn: game is not active (status: ${state.status}).`);
  }
  if (state.phase !== "awaiting-move") {
    throw new Error("Cannot end turn before rolling.");
  }
  if (getValidMoves(state, state.currentTurnPlayerId).length > 0) {
    throw new Error("Cannot end turn while a legal move is available.");
  }

  const next = cloneState(state);

  /**
   * Locked out of the board with rolls to spare: another roll, not a hand-off.
   *
   * This is the whole of the three-roll rule, and it lives here because this is
   * the one funnel every forced pass goes through — client prediction and
   * server authority both reach it, so neither can implement it differently.
   *
   * The turn does not restart: `yardRolls` counts up within it and is cleared
   * by advanceTurn, so three is three however the rolls are spread. Nothing
   * else about the state moves — same player, same clock, back to
   * awaiting-roll — which is exactly what a player who rolled a dud and is
   * still sitting there expects to see.
   */
  if (
    state.rules.threeRollsFromYard &&
    stuckInYard(state, state.currentTurnPlayerId) &&
    (state.yardRolls ?? 0) + 1 < YARD_ROLLS
  ) {
    next.yardRolls = (state.yardRolls ?? 0) + 1;
    next.phase = "awaiting-roll";
    next.diceValue = null;
    next.lastAction = makeAction(
      "endTurn",
      { playerId: state.currentTurnPlayerId, yardRoll: next.yardRolls },
      options.now,
    );
    return next;
  }

  next.lastAction = makeAction("endTurn", { playerId: state.currentTurnPlayerId }, options.now);
  handOff(next);
  return next;
}
