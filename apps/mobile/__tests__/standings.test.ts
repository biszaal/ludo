/**
 * Standings ranking: finished tokens first, then path progress; ties share a
 * rank. Uses a real engine game mutated into known token layouts.
 */

import { describe, it, expect } from "vitest";
import { createGame, type GameState, type TokenPosition } from "@ludo/engine";
import { computeStandings } from "../src/lib/standings";

function game(): GameState {
  return createGame([
    { id: "p1", userId: "u1", color: "red" },
    { id: "p2", userId: "u2", color: "yellow" },
    { id: "p3", userId: "u3", color: "green" },
  ]);
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
});
