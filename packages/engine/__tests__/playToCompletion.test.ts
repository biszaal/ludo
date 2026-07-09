/**
 * Play-to-completion: one player finishing does not end a 3–4 player game.
 * Finishers join finishedOrder (first = winner), are skipped by the turn
 * clock, and the game ends when a single unfinished player remains — appended
 * last, so finishedOrder is the full final standings.
 */

import { describe, it, expect } from "vitest";
import { applyMove, skipTurn } from "../src/index.js";
import { fourPlayerGame, twoPlayerGame, withDice, withToken } from "./helpers.js";

/** p1 (red) with three tokens finished and the fourth one step from the center. */
function p1AboutToFinish(base = fourPlayerGame()) {
  let state = base;
  state = withToken(state, "red-0", "finished");
  state = withToken(state, "red-1", "finished");
  state = withToken(state, "red-2", "finished");
  state = withToken(state, "red-3", { type: "homePath", index: 4 }); // one step (roll 1) from finish
  return withDice(state, 1);
}

describe("play to completion", () => {
  it("keeps a 4-player game active after the first player finishes", () => {
    const next = applyMove(p1AboutToFinish(), { tokenId: "red-3" });

    expect(next.status).toBe("active");
    expect(next.finishedOrder).toEqual(["p1"]);
    expect(next.winnerPlayerId).toBe("p1"); // 1st place locked in
    expect(next.currentTurnPlayerId).toBe("p2"); // hand-off, no bonus for finishing
  });

  it("skips finished players in the turn rotation", () => {
    const afterFinish = applyMove(p1AboutToFinish(), { tokenId: "red-3" });

    // p2 → p3 → p4 → back to p2 (p1 is skipped forever).
    let state = skipTurn(afterFinish); // p2 idles out
    expect(state.currentTurnPlayerId).toBe("p3");
    state = skipTurn(state);
    expect(state.currentTurnPlayerId).toBe("p4");
    state = skipTurn(state);
    expect(state.currentTurnPlayerId).toBe("p2"); // NOT p1
  });

  it("ends the game when only one unfinished player remains, appending them last", () => {
    // p2 (green) and p3 (yellow) already finished; p1 finishes now → only p4 left.
    let state = p1AboutToFinish();
    for (const id of ["green-0", "green-1", "green-2", "green-3", "yellow-0", "yellow-1", "yellow-2", "yellow-3"]) {
      state = withToken(state, id, "finished");
    }
    state = { ...state, finishedOrder: ["p2", "p3"], winnerPlayerId: "p2" };

    const next = applyMove(state, { tokenId: "red-3" });

    expect(next.status).toBe("finished");
    expect(next.finishedOrder).toEqual(["p2", "p3", "p1", "p4"]); // p4 gets last place
    expect(next.winnerPlayerId).toBe("p2"); // first finisher stays the winner
  });

  it("still ends a 2-player game on the first finish (loser appended)", () => {
    let state = twoPlayerGame();
    state = withToken(state, "red-0", "finished");
    state = withToken(state, "red-1", "finished");
    state = withToken(state, "red-2", "finished");
    state = withToken(state, "red-3", { type: "homePath", index: 4 });
    state = withDice(state, 1);

    const next = applyMove(state, { tokenId: "red-3" });
    expect(next.status).toBe("finished");
    expect(next.finishedOrder).toEqual(["p1", "p2"]);
    expect(next.winnerPlayerId).toBe("p1");
  });
});
