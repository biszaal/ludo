/**
 * Regression: a table nobody is playing must be able to end.
 *
 * Production accumulated games that could never reach `finished`. In the worst
 * one both humans had left and both bots had finished all four tokens, so:
 *   - the finish check counted the two leavers as "still to play", never
 *     reaching the one-remaining-player rule, and
 *   - advanceTurn, which does skip leavers, found no legal successor and parked
 *     the clock on a player who was already done.
 * The turn deadline then expired every minute forever, and the cron tick wrote
 * a fresh forced pass each time — 5,567 move rows on one abandoned table.
 *
 * The invariant these tests pin: after any hand-off, either someone is in play
 * or the game is finished. Never neither.
 */

import { describe, expect, it } from "vitest";
import { endTurn } from "../src/endTurn.js";
import { skipTurn } from "../src/skipTurn.js";
import { leaveGame } from "../src/leaveGame.js";
import { applyMove } from "../src/applyMove.js";
import { inPlayPlayers } from "../src/internal.js";
import { fourPlayerGame, withDice, withToken } from "./helpers.js";
import type { GameState } from "../src/types.js";

/** Mark every one of a player's tokens finished. */
function finishAll(state: GameState, playerId: string): GameState {
  let cur = state;
  for (const t of state.tokens.filter((tk) => tk.playerId === playerId)) {
    cur = withToken(cur, t.id, "finished");
  }
  return cur;
}

/**
 * The exact shape of production game TMKM: seats red/green (humans) left,
 * seats yellow/blue (bots) placed 1st and 2nd, clock parked on blue.
 */
function abandonedTable(): GameState {
  let state = fourPlayerGame();
  state = finishAll(state, "p3");
  state = finishAll(state, "p4");
  state = {
    ...state,
    finishedOrder: ["p3", "p4"],
    winnerPlayerId: "p3",
    players: state.players.map((p) => (p.id === "p1" || p.id === "p2" ? { ...p, hasLeft: true } : p)),
    tokens: state.tokens.filter((t) => t.playerId !== "p1" && t.playerId !== "p2"),
    currentTurnPlayerId: "p4",
  };
  return state;
}

describe("abandoned table", () => {
  it("has nobody in play once every seat has left or finished", () => {
    expect(inPlayPlayers(abandonedTable())).toHaveLength(0);
  });

  it("ends on the next forced pass instead of spinning the clock", () => {
    const next = endTurn(withDice(abandonedTable(), 3));
    expect(next.status).toBe("finished");
    expect(next.winnerPlayerId).toBe("p3");
  });

  it("ends on a skipped turn too", () => {
    const next = skipTurn(abandonedTable());
    expect(next.status).toBe("finished");
  });

  it("never leaves the clock on a player who is done", () => {
    const next = skipTurn(abandonedTable());
    expect(next.status).toBe("finished");
    // The decisive property: no state may be active with nobody able to act.
    expect(inPlayPlayers(next).length === 0 && next.status === "active").toBe(false);
  });
});

describe("leaving mid-game", () => {
  it("ends the game when the last in-play player leaves, even with placed seats", () => {
    // p3 has already won; p1 and p2 leave; p4 is the only one still racing.
    let state = finishAll(fourPlayerGame(), "p3");
    state = { ...state, finishedOrder: ["p3"], winnerPlayerId: "p3" };

    const afterFirst = leaveGame(state, "p1");
    expect(afterFirst.status).toBe("active"); // p4 still racing

    const afterSecond = leaveGame(afterFirst, "p2");
    expect(afterSecond.status).toBe("finished");
    expect(afterSecond.winnerPlayerId).toBe("p3");
    // p4 inherits the last placement rather than being left mid-race.
    expect(afterSecond.finishedOrder).toEqual(["p3", "p4"]);
  });

  it("does not count a leaver as the last player standing", () => {
    // p1 left long ago; p2 now finishes. Only p3/p4 are genuinely still racing,
    // so the game continues — but the leaver must not pad that count either.
    let state = leaveGame(fourPlayerGame(), "p1");
    state = { ...state, finishedOrder: ["p2"], winnerPlayerId: "p2", currentTurnPlayerId: "p3" };
    expect(inPlayPlayers(state).map((p) => p.id)).toEqual(["p3", "p4"]);
  });
});

describe("finishing the last token", () => {
  it("ends the game when the only other players have left", () => {
    // p2/p3/p4 gone; p1 brings their final token home. Old behaviour: the three
    // leavers still counted as remaining, so this never ended the game.
    let state = fourPlayerGame();
    state = leaveGame(state, "p2");
    state = leaveGame(state, "p3");
    // Two leavers of four leaves p1 and p4 — finish p1 while p4 still races.
    expect(state.status).toBe("active");

    state = leaveGame(state, "p4");
    // p1 is now the last one standing: leaveGame ends it immediately.
    expect(state.status).toBe("finished");
    expect(state.finishedOrder).toContain("p1");
  });

  it("ends via applyMove when the winner's last rival has left", () => {
    let state = fourPlayerGame();
    state = leaveGame(state, "p3");
    state = leaveGame(state, "p4");
    // p1 and p2 remain. Park p1 one step from home on its last token.
    for (const t of state.tokens.filter((tk) => tk.playerId === "p1").slice(0, 3)) {
      state = withToken(state, t.id, "finished");
    }
    const last = state.tokens.find((t) => t.playerId === "p1" && t.position !== "finished")!;
    state = withToken(state, last.id, { type: "homePath", index: 4 });
    state = { ...state, currentTurnPlayerId: "p1" };
    state = withDice(state, 1);

    const next = applyMove(state, { tokenId: last.id });
    expect(next.status).toBe("finished");
    expect(next.winnerPlayerId).toBe("p1");
    expect(next.finishedOrder).toEqual(["p1", "p2"]);
  });
});
