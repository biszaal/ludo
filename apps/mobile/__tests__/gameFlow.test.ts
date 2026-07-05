/**
 * End-to-end test of the client store — the M2 glue between UI intents and the
 * engine. Drives a full hot-seat game through the exact actions the screens call
 * (roll / selectToken / pass) and asserts the game completes coherently.
 *
 * Math.random is seeded so runs are deterministic (the store uses mathRandomRng,
 * which late-binds Math.random).
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { createSeededRng } from "@ludo/engine";
import { useGameStore } from "../src/store/gameStore";

const store = useGameStore;

function playFullGame(seed: number, numPlayers: number) {
  const rng = createSeededRng(seed);
  vi.spyOn(Math, "random").mockImplementation(() => rng());

  store.getState().newLocalGame(numPlayers);

  for (let steps = 0; steps < 200_000; steps++) {
    const s = store.getState();
    const game = s.state!;
    if (game.status === "finished") break;

    if (game.phase === "awaiting-roll") {
      s.roll();
    } else if (s.validMoves.length === 0) {
      s.pass();
    } else {
      s.selectToken(s.validMoves[0]!.tokenId);
    }
  }
  return store.getState();
}

afterEach(() => {
  vi.restoreAllMocks();
  store.getState().leaveGame();
});

describe("client store — full hot-seat game", () => {
  it("starts a 2-player game and routes to the game screen", () => {
    store.getState().newLocalGame(2);
    const s = store.getState();
    expect(s.screen).toBe("game");
    expect(s.state?.players).toHaveLength(2);
    expect(s.message).toContain("Red");
  });

  it("seats 2 players on a diagonal (red + yellow)", () => {
    store.getState().newLocalGame(2);
    expect(store.getState().state?.players.map((p) => p.color)).toEqual(["red", "yellow"]);
  });

  it.each([1, 7, 42])("plays a 2-player game to a winner via store intents (seed %i)", (seed) => {
    const final = playFullGame(seed, 2);
    expect(final.state?.status).toBe("finished");
    expect(final.message).toContain("wins");
    expect(final.validMoves).toEqual([]);
  });

  it.each([3, 99])("plays a 4-player game to a winner (seed %i)", (seed) => {
    const final = playFullGame(seed, 4);
    expect(final.state?.status).toBe("finished");
    expect(final.message).toContain("wins");
  });

  it("only ever exposes movable tokens that belong to the current player", () => {
    const rng = createSeededRng(5);
    vi.spyOn(Math, "random").mockImplementation(() => rng());
    store.getState().newLocalGame(2);

    for (let steps = 0; steps < 5_000; steps++) {
      const s = store.getState();
      const game = s.state!;
      if (game.status === "finished") break;

      for (const move of s.validMoves) {
        const token = game.tokens.find((t) => t.id === move.tokenId)!;
        expect(token.playerId).toBe(game.currentTurnPlayerId);
      }

      if (game.phase === "awaiting-roll") s.roll();
      else if (s.validMoves.length === 0) s.pass();
      else s.selectToken(s.validMoves[0]!.tokenId);
    }
  });
});
