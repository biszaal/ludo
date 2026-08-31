/** Shared test utilities. Not a test file (excluded by the `*.test.ts` glob). */

import { createGame } from "../src/createGame.js";
import type { GameState, Phase, TokenPosition } from "../src/types.js";
import type { Rng } from "../src/rng.js";

export function twoPlayerGame(): GameState {
  return createGame(
    [
      { id: "p1", userId: "u1", color: "red" },
      { id: "p2", userId: "u2", color: "yellow" },
    ],
    { gameId: "g1" },
  );
}

export function fourPlayerGame(): GameState {
  return createGame(
    [
      { id: "p1", userId: "u1", color: "red" },
      { id: "p2", userId: "u2", color: "green" },
      { id: "p3", userId: "u3", color: "yellow" },
      { id: "p4", userId: "u4", color: "blue" },
    ],
    { gameId: "g4" },
  );
}

/** Immutably set one token's position. */
export function withToken(state: GameState, tokenId: string, position: TokenPosition): GameState {
  return {
    ...state,
    tokens: state.tokens.map((t) => (t.id === tokenId ? { ...t, position } : t)),
  };
}

/** Put the game into `awaiting-move` with a known dice value (skips the roll). */
export function withDice(state: GameState, diceValue: number, phase: Phase = "awaiting-move"): GameState {
  return { ...state, phase, diceValue };
}

/**
 * An {@link Rng} that yields the supplied dice sequence (cycling). Each value `d`
 * is mapped to a float in `[(d-1)/6, d/6)` so `rollDie` reproduces it exactly.
 */
export function scriptedRng(dice: number[]): Rng {
  let i = 0;
  return () => {
    const d = dice[i++ % dice.length]!;
    return (d - 0.5) / 6;
  };
}
