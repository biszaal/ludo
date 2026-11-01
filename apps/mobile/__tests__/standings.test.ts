/**
 * Standings ranking: finished tokens first, then path progress; ties share a
 * rank. Uses a real engine game mutated into known token layouts.
 */

import { describe, it, expect } from "vitest";
import { createGame, type CreateGameOptions, type GameState, type TokenPosition } from "@ludo/engine";
import { computeStandings, tokensToWin, variantOf } from "../src/lib/standings";

function game(options: CreateGameOptions = {}): GameState {
  return createGame(
    [
      { id: "p1", userId: "u1", color: "red" },
      { id: "p2", userId: "u2", color: "yellow" },
      { id: "p3", userId: "u3", color: "green" },
    ],
    options,
  );
}

function place(state: GameState, tokenId: string, position: TokenPosition): GameState {
  return { ...state, tokens: state.tokens.map((t) => (t.id === tokenId ? { ...t, position } : t)) };
}

describe("computeStandings", () => {
  it("ranks by finished tokens, then progress", () => {
    let s = game();
    // p2: one finished. p1: none finished but one token far along. p3: all in yard.
    s = place(s, "yellow-0", "finished");
    s = place(s, "red-0", { type: "homePath", index: 3 });

    const rows = computeStandings(s);
    expect(rows.map((r) => r.playerId)).toEqual(["p2", "p1", "p3"]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(rows[0]!.finished).toBe(1);
  });

  it("breaks a finished tie by progress", () => {
    let s = game();
    s = place(s, "red-0", "finished");
    s = place(s, "yellow-0", "finished");
    s = place(s, "yellow-1", { type: "homePath", index: 2 }); // yellow further along

    const rows = computeStandings(s);
    expect(rows[0]!.playerId).toBe("p2");
    expect(rows[1]!.playerId).toBe("p1");
  });

  it("gives identical players a shared rank", () => {
    const rows = computeStandings(game()); // everyone in the yard
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 1]);
  });

  it("ranks unplaced Blitz players by their lead token, not their total", () => {
    // p1: one runner deep in the home column. p2: four runners a third of the
    // way round — more travel in total, but nowhere near a first token home.
    const layout = (s: GameState) => {
      s = place(s, "red-0", { type: "homePath", index: 3 });
      for (const id of ["yellow-0", "yellow-1", "yellow-2", "yellow-3"]) s = place(s, id, { type: "track", index: 41 });
      return s;
    };

    expect(computeStandings(layout(game())).map((r) => r.playerId)).toEqual(["p2", "p1", "p3"]);
    expect(computeStandings(layout(game({ rules: { tokensToWin: 1 } }))).map((r) => r.playerId)).toEqual([
      "p1",
      "p2",
      "p3",
    ]);
  });
});

describe("game variant", () => {
  it("reads classic, Blitz and Frenzy off the state itself", () => {
    expect(variantOf(game())).toBe("classic");
    expect(variantOf(game({ rules: { tokensToWin: 1 } }))).toBe("blitz");
    expect(variantOf(game({ frenzy: true }))).toBe("frenzy");
  });

  it("says how many tokens a seat needs home", () => {
    expect(tokensToWin(game())).toBe(4);
    expect(tokensToWin(game({ rules: { tokensToWin: 1 } }))).toBe(1);
  });
});
