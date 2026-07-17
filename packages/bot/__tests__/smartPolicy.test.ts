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
import { chooseMove, type BotDifficulty } from "../src/index.js";

function game2(): GameState {
  return createGame(
    [
      { id: "p1", userId: "u1", color: "red" },
      { id: "p2", userId: "u2", color: "yellow" },
    ],
    { gameId: "g" },
  );
}

function withToken(state: GameState, tokenId: string, position: TokenPosition): GameState {
  return { ...state, tokens: state.tokens.map((t) => (t.id === tokenId ? { ...t, position } : t)) };
}

function withDice(state: GameState, diceValue: number): GameState {
  return { ...state, phase: "awaiting-move", diceValue };
}

function movesFor(state: GameState) {
  return getValidMoves(state, "p1");
}

describe("smart policy (default difficulty)", () => {
  it("avoids landing inside an opponent's capture range when an equal advance exists", () => {
    // red-0 leads on raw progress but would land 1 in front of a yellow token
    // (capturable next roll); red-1 lands in open space. The stalker at 31 sits
    // AHEAD of red-0's origin, so no escape credit muddies the comparison.
    let state = game2();
    state = withToken(state, "red-0", { type: "track", index: 30 });
    state = withToken(state, "red-1", { type: "track", index: 22 });
    state = withToken(state, "yellow-0", { type: "track", index: 31 }); // 1 behind red-0's landing
    state = withDice(state, 2);
    // red-0 → 32 (yellow at 31 takes it with a 1); red-1 → 24 (nothing near).
    const move = chooseMove(state, "p1", movesFor(state));
    expect(move.tokenId).toBe("red-1");
  });

  it("escapes a threatened advanced token instead of advancing a safe one", () => {
    let state = game2();
    state = withToken(state, "red-0", { type: "track", index: 31 }); // yellow-0 at 28 is 3 behind
    state = withToken(state, "red-1", { type: "track", index: 10 }); // nothing near
    state = withToken(state, "yellow-0", { type: "track", index: 28 });
    state = withDice(state, 6);
    // red-0 → 37 outruns the stalker; red-1 → 16 gains less and leaves red-0 exposed.
    const move = chooseMove(state, "p1", movesFor(state));
    expect(move.tokenId).toBe("red-0");
  });

  it("prefers stepping onto a safe star over open ground", () => {
    let state = game2();
    state = withToken(state, "red-0", { type: "track", index: 6 }); // +2 → 8, a star
    state = withToken(state, "red-1", { type: "track", index: 9 }); // +2 → 11, open
    state = withToken(state, "yellow-0", { type: "track", index: 2 }); // pressure behind both
    state = withDice(state, 2);
    const move = chooseMove(state, "p1", movesFor(state));
    expect(move.tokenId).toBe("red-0");
  });

  it("spreads: brings a second token out rather than pushing a lone runner", () => {
    let state = game2();
    state = withToken(state, "red-0", { type: "track", index: 20 });
    state = withDice(state, 6);
    // Options: advance red-0 to 26 (a safe cell!) or enter a yarded token.
    // With one token on board the spread bonus (250) must beat plain progress
    // but not the safe cell (600) — entering wins only against open ground.
    state = withToken(state, "red-0", { type: "track", index: 19 }); // +6 → 25, open
    const move = chooseMove(state, "p1", movesFor(state));
    expect(move.from).toBe("home");
  });

  it("still takes a capture over everything else", () => {
    let state = game2();
    state = withToken(state, "red-0", { type: "track", index: 3 });
    state = withToken(state, "red-1", { type: "track", index: 40 });
    state = withToken(state, "yellow-0", { type: "track", index: 5 });
    state = withDice(state, 2);
    const move = chooseMove(state, "p1", movesFor(state));
    expect(move.tokenId).toBe("red-0");
    expect(move.captures).toContain("yellow-0");
  });
});

describe("self-play: hard beats easy", () => {
  function playGame(seed: number, p1Difficulty: BotDifficulty, p2Difficulty: BotDifficulty): string {
    let state = createGame(
      [
        { id: "p1", userId: "u1", color: "red" },
        { id: "p2", userId: "u2", color: "yellow" },
      ],
      { gameId: `sim-${seed}` },
    );
    const rng = createSeededRng(seed);
    const diff: Record<string, BotDifficulty> = { p1: p1Difficulty, p2: p2Difficulty };
    for (let steps = 0; steps < 200_000 && state.status === "active"; steps++) {
      if (state.phase === "awaiting-roll") {
        state = rollDice(state, rng).newState;
      } else {
        const pid = state.currentTurnPlayerId;
        const moves = getValidMoves(state, pid);
        state =
          moves.length === 0
            ? endTurn(state)
            : applyMove(state, chooseMove(state, pid, moves, { rng, difficulty: diff[pid] }));
      }
    }
    return state.winnerPlayerId!;
  }

  it("wins a clear majority over 200 seeded games (seats alternated)", () => {
    let hardWins = 0;
    const games = 200;
    for (let seed = 1; seed <= games; seed++) {
      // Alternate seats so first-mover advantage cancels out.
      if (seed % 2 === 1) {
        if (playGame(seed, "hard", "easy") === "p1") hardWins++;
      } else {
        if (playGame(seed, "easy", "hard") === "p2") hardWins++;
      }
    }
    expect(hardWins / games).toBeGreaterThan(0.55);
  }, 60_000);
});
