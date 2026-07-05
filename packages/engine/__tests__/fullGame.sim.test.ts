import { describe, it, expect } from "vitest";
import {
  applyMove,
  checkWin,
  createGame,
  createSeededRng,
  endTurn,
  getValidMoves,
  rollDice,
  toRelativeIndex,
  type GameState,
  type Move,
  type PlayerInput,
} from "../src/index.js";

/** Greedy policy: capture > finish > most advanced token > first available. */
function pickMove(state: GameState, moves: Move[]): Move {
  const colorOf = (tokenId: string) => state.tokens.find((t) => t.id === tokenId)!.color;
  return [...moves].sort((a, b) => {
    if (a.captures.length !== b.captures.length) return b.captures.length - a.captures.length;
    if (a.finishes !== b.finishes) return Number(b.finishes) - Number(a.finishes);
    const ra = toRelativeIndex(colorOf(a.tokenId), a.to) ?? -1;
    const rb = toRelativeIndex(colorOf(b.tokenId), b.to) ?? -1;
    return rb - ra;
  })[0]!;
}

/** Assert structural invariants that must hold after every transition. */
function assertInvariants(state: GameState, tokenCount: number): void {
  expect(state.tokens).toHaveLength(tokenCount);
  for (const token of state.tokens) {
    if (token.position === "home" || token.position === "finished") continue;
    if (token.position.type === "track") {
      expect(token.position.index).toBeGreaterThanOrEqual(0);
      expect(token.position.index).toBeLessThan(52);
    } else {
      expect(token.position.index).toBeGreaterThanOrEqual(0);
      expect(token.position.index).toBeLessThan(5);
    }
  }
}

/** Drive a complete game with a seeded RNG and the greedy policy. */
function playToCompletion(players: PlayerInput[], seed: number): GameState {
  let state = createGame(players, { gameId: `sim-${seed}` });

  const rng = createSeededRng(seed);
  const tokenCount = state.tokens.length;
  const MAX_STEPS = 200_000;

  let steps = 0;
  while (state.status === "active" && steps < MAX_STEPS) {
    steps++;
    if (state.phase === "awaiting-roll") {
      state = rollDice(state, rng).newState;
    } else {
      const moves = getValidMoves(state, state.currentTurnPlayerId);
      state = moves.length === 0 ? endTurn(state) : applyMove(state, pickMove(state, moves));
    }
    assertInvariants(state, tokenCount);
  }
  return state;
}

const TWO: PlayerInput[] = [
  { id: "p1", userId: "u1", color: "red" },
  { id: "p2", userId: "u2", color: "yellow" },
];
const FOUR: PlayerInput[] = [
  { id: "p1", userId: "u1", color: "red" },
  { id: "p2", userId: "u2", color: "green" },
  { id: "p3", userId: "u3", color: "yellow" },
  { id: "p4", userId: "u4", color: "blue" },
];

describe("full-game simulation (deterministic)", () => {
  it.each([1, 7, 42, 1337])("a 2-player game always terminates with a valid winner (seed %i)", (seed) => {
    const final = playToCompletion(TWO, seed);
    expect(final.status).toBe("finished");
    const win = checkWin(final);
    expect(win.finished).toBe(true);
    const winnerTokens = final.tokens.filter((t) => t.playerId === win.winnerPlayerId);
    expect(winnerTokens.every((t) => t.position === "finished")).toBe(true);
  });

  it.each([2, 9, 100, 2024])("a 4-player game always terminates with a valid winner (seed %i)", (seed) => {
    const final = playToCompletion(FOUR, seed);
    expect(final.status).toBe("finished");
    expect(checkWin(final).finished).toBe(true);
  });

  it("produces the same outcome for the same seed (determinism)", () => {
    const a = playToCompletion(FOUR, 777);
    const b = playToCompletion(FOUR, 777);
    expect(a.winnerPlayerId).toBe(b.winnerPlayerId);
    expect(JSON.stringify(a.tokens)).toBe(JSON.stringify(b.tokens));
  });
});
