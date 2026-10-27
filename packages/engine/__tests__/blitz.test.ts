/**
 * Blitz: `rules.tokensToWin = 1`. The first token home places its player, whose
 * remaining tokens then leave the board; the game still plays on until one
 * player is left unplaced, exactly like a classic game does.
 */

import { describe, it, expect } from "vitest";
import { applyMove, checkWin, createGame, hasPlayerWon } from "../src/index.js";
import { withDice, withToken } from "./helpers.js";

function blitzGame(count: 2 | 4) {
  const colors = count === 2 ? (["red", "yellow"] as const) : (["red", "green", "yellow", "blue"] as const);
  return createGame(
    colors.map((color, i) => ({ id: `p${i + 1}`, userId: `u${i + 1}`, color })),
    { gameId: "blitz", rules: { tokensToWin: 1 } },
  );
}

/** p1 (red): red-0 one step from the center, red-1 out on the track, the rest in the yard. */
function redAboutToPlace(base: ReturnType<typeof blitzGame>) {
  let state = withToken(base, "red-0", { type: "homePath", index: 4 });
  state = withToken(state, "red-1", { type: "track", index: 10 });
  return withDice(state, 1);
}

describe("blitz", () => {
  it("places a player the moment their first token reaches home", () => {
    const next = applyMove(redAboutToPlace(blitzGame(4)), { tokenId: "red-0" });

    expect(next.finishedOrder).toEqual(["p1"]);
    expect(next.winnerPlayerId).toBe("p1");
    expect(next.status).toBe("active");
    expect(next.currentTurnPlayerId).toBe("p2"); // placing earns no bonus roll
  });

  it("takes the placed player's other tokens off the board", () => {
    const next = applyMove(redAboutToPlace(blitzGame(4)), { tokenId: "red-0" });

    const red = next.tokens.filter((t) => t.playerId === "p1");
    expect(red).toEqual([expect.objectContaining({ id: "red-0", position: "finished" })]);
    expect(hasPlayerWon(next, "p1")).toBe(true);
  });

  it("ends a 2-player game on the first token home", () => {
    const next = applyMove(redAboutToPlace(blitzGame(2)), { tokenId: "red-0" });

    expect(next.status).toBe("finished");
    expect(next.finishedOrder).toEqual(["p1", "p2"]);
    expect(checkWin(next)).toEqual({ finished: true, winnerPlayerId: "p1" });
  });

  it("plays a 4-player game on until one player is left unplaced", () => {
    // p2 and p3 already placed (one token each, the rest cleared); p1 places now.
    let state = redAboutToPlace(blitzGame(4));
    state = {
      ...state,
      tokens: state.tokens.filter(
        (t) => (t.playerId !== "p2" && t.playerId !== "p3") || t.id === "green-0" || t.id === "yellow-0",
      ),
      finishedOrder: ["p2", "p3"],
      winnerPlayerId: "p2",
    };
    state = withToken(withToken(state, "green-0", "finished"), "yellow-0", "finished");

    const next = applyMove(state, { tokenId: "red-0" });

    expect(next.status).toBe("finished");
    expect(next.finishedOrder).toEqual(["p2", "p3", "p1", "p4"]);
    expect(next.winnerPlayerId).toBe("p2");
  });

  it("does not place a classic player for one token home", () => {
    const classic = createGame(
      [
        { id: "p1", userId: "u1", color: "red" },
        { id: "p2", userId: "u2", color: "green" },
        { id: "p3", userId: "u3", color: "yellow" },
      ],
      { gameId: "classic" },
    );
    const next = applyMove(withDice(withToken(classic, "red-0", { type: "homePath", index: 4 }), 1), {
      tokenId: "red-0",
    });

    expect(next.finishedOrder).toEqual([]);
    expect(next.tokens.filter((t) => t.playerId === "p1")).toHaveLength(4);
  });

  it("leaves classic states without a tokensToWin key", () => {
    // Online play confirms predictions by comparing state JSON byte for byte,
    // so a classic game must not grow a key that the server's copy lacks.
    const classic = createGame([
      { id: "p1", userId: "u1" },
      { id: "p2", userId: "u2" },
    ]);
    expect("tokensToWin" in classic.rules).toBe(false);
  });
});
