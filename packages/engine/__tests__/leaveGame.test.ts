/**
 * leaveGame: a player quitting for good — tokens removed, turn clock skips
 * them, last player standing ends the game with full standings.
 */

import { describe, expect, it } from "vitest";
import { leaveGame } from "../src/leaveGame.js";
import { skipTurn } from "../src/skipTurn.js";
import { fourPlayerGame, twoPlayerGame, withToken } from "./helpers.js";
import type { GameState } from "../src/types.js";

/** Mark every one of a player's tokens finished (the helper keeps it terse). */
function finishAll(state: GameState, playerId: string): GameState {
  let cur = state;
  for (const t of state.tokens.filter((tk) => tk.playerId === playerId)) {
    cur = withToken(cur, t.id, "finished");
  }
  return cur;
}

describe("leaveGame", () => {
  it("removes the leaver's tokens and flags the seat", () => {
    const next = leaveGame(fourPlayerGame(), "p2");
    expect(next.tokens.some((t) => t.playerId === "p2")).toBe(false);
    expect(next.tokens).toHaveLength(12); // the other three keep 4 each
    const p2 = next.players.find((p) => p.id === "p2")!;
    expect(p2.hasLeft).toBe(true);
    expect(p2.isConnected).toBe(false);
    expect(next.lastAction).toMatchObject({ type: "leave", payload: { playerId: "p2" } });
  });

  it("hands the turn to the next in-play player when the leaver held it", () => {
    const state = fourPlayerGame(); // red (p1) to move
    const next = leaveGame(state, "p1");
    expect(next.currentTurnPlayerId).toBe("p2");
    expect(next.phase).toBe("awaiting-roll");
    expect(next.diceValue).toBeNull();
  });

  it("keeps the turn where it is when a non-current player leaves", () => {
    const next = leaveGame(fourPlayerGame(), "p3");
    expect(next.currentTurnPlayerId).toBe("p1");
    expect(next.status).toBe("active");
  });

  it("skips the leaver on every later lap of the turn clock", () => {
    let cur = leaveGame(fourPlayerGame(), "p2"); // red still to move
    // Skip through a full lap: p1 -> p3 -> p4 -> p1 (p2 never comes up).
    const seen: string[] = [cur.currentTurnPlayerId];
    for (let i = 0; i < 3; i++) {
      cur = skipTurn(cur);
      seen.push(cur.currentTurnPlayerId);
    }
    expect(seen).toEqual(["p1", "p3", "p4", "p1"]);
  });

  it("ends a 2-player game — the opponent inherits the win", () => {
    const next = leaveGame(twoPlayerGame(), "p1");
    expect(next.status).toBe("finished");
    expect(next.finishedOrder).toEqual(["p2"]);
    expect(next.winnerPlayerId).toBe("p2");
  });

  it("ends the game when the second-to-last racer leaves, keeping earlier placements", () => {
    // p1 already finished 1st in a 3-way race among p1/p2/p3 (p4 left earlier).
    let state = finishAll(fourPlayerGame(), "p1");
    state = { ...state, finishedOrder: ["p1"], winnerPlayerId: "p1" };
    state = leaveGame(state, "p4");
    expect(state.status).toBe("active"); // p2 + p3 still racing
    const done = leaveGame(state, "p2");
    expect(done.status).toBe("finished");
    expect(done.finishedOrder).toEqual(["p1", "p3"]); // leavers never place
    expect(done.winnerPlayerId).toBe("p1");
  });

  it("a finished player leaving keeps their tokens and placement", () => {
    let state = finishAll(fourPlayerGame(), "p1");
    state = { ...state, finishedOrder: ["p1"], winnerPlayerId: "p1" };
    const next = leaveGame(state, "p1");
    expect(next.tokens.filter((t) => t.playerId === "p1")).toHaveLength(4);
    expect(next.finishedOrder).toContain("p1");
    expect(next.players.find((p) => p.id === "p1")!.hasLeft).toBe(true);
    expect(next.status).toBe("active"); // three others still racing
  });

  it("is idempotent — leaving twice changes nothing", () => {
    const once = leaveGame(fourPlayerGame(), "p2");
    const twice = leaveGame(once, "p2");
    expect(twice).toEqual(once);
  });

  it("throws on a non-active game", () => {
    const finished = { ...twoPlayerGame(), status: "finished" as const };
    expect(() => leaveGame(finished, "p1")).toThrow(/not active/);
  });

  it("throws on an unknown player", () => {
    expect(() => leaveGame(twoPlayerGame(), "nope")).toThrow(/Unknown player/);
  });
});
