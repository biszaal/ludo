/**
 * Blitz (`rules.tokensToWin = 1`) is won by the first token home, so the bot
 * has to race its leader instead of spreading progress across four runners.
 * The evaluator weights each seat's lead token in full and the rest as backups.
 *
 * Measured over 1500 seeded heads-up Blitz games, hard beats normal 56.7% of
 * the time with that weighting and 50.3% without it (the classic evaluator
 * gained nothing over the heuristic). The threshold sits well below the
 * measurement so dice variance cannot fail it.
 */

import { describe, it, expect } from "vitest";
import {
  applyMove,
  createGame,
  createSeededRng,
  endTurn,
  getValidMoves,
  rollDice,
  type GameState,
  type TokenPosition,
} from "@ludo/engine";
import { chooseMove, type BotOptions } from "../src/index.js";

const COLORS = ["red", "yellow"] as const;

function game(tokensToWin: number | undefined, gameId = "g"): GameState {
  return createGame(
    COLORS.map((color, i) => ({ id: `p${i}`, userId: `u${i}`, color })),
    { gameId, rules: tokensToWin === undefined ? {} : { tokensToWin } },
  );
}

function withToken(state: GameState, tokenId: string, position: TokenPosition): GameState {
  if (!state.tokens.some((t) => t.id === tokenId)) throw new Error(`No such token: ${tokenId}`);
  return { ...state, tokens: state.tokens.map((t) => (t.id === tokenId ? { ...t, position } : t)) };
}

/** Red holds a six with one runner mid-lap and the rest in the yard; yellow is all yard. */
function sixWithRunner(tokensToWin: number | undefined): GameState {
  const state = withToken(game(tokensToWin), "red-0", { type: "track", index: 30 });
  return { ...state, phase: "awaiting-move", diceValue: 6 };
}

function pick(state: GameState): string {
  return chooseMove(state, "p0", getValidMoves(state, "p0"), { rng: () => 0 }).tokenId;
}

function playGame(seed: number, cfg: Record<string, BotOptions>): string[] {
  let state = game(1, `blitz-${seed}`);
  const rng = createSeededRng(seed);
  for (let step = 0; step < 100_000 && state.status === "active"; step++) {
    if (state.phase === "awaiting-roll") {
      state = rollDice(state, rng).newState;
      continue;
    }
    const pid = state.currentTurnPlayerId;
    const moves = getValidMoves(state, pid);
    state = moves.length === 0 ? endTurn(state) : applyMove(state, chooseMove(state, pid, moves, { rng, ...cfg[pid] }));
  }
  return state.finishedOrder ?? [];
}

describe("blitz bot", () => {
  it("opens a second runner in classic but races the leader in Blitz", () => {
    expect(pick(sixWithRunner(undefined))).toBe("red-1");
    expect(pick(sixWithRunner(1))).toBe("red-0");
  });

  it("still beats the normal heuristic heads-up at Blitz", () => {
    let hardWins = 0;
    const games = 300;
    for (let seed = 1; seed <= games; seed++) {
      // Alternate who sits first so the opening roll does not favour one side.
      const hardSeat = seed % 2 === 0 ? "p0" : "p1";
      const normalSeat = hardSeat === "p0" ? "p1" : "p0";
      const order = playGame(seed, { [hardSeat]: { difficulty: "hard" }, [normalSeat]: { difficulty: "normal" } });
      if (order[0] === hardSeat) hardWins++;
    }
    expect(hardWins / games).toBeGreaterThan(0.52);
  }, 60_000);
});
