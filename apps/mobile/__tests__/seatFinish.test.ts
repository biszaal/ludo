/**
 * Who the end-of-race screens are for. The game plays to completion, so the
 * question is never "did someone win" but "is MY race over" — see seatFinish.
 */

import { describe, it, expect } from "vitest";
import { createGame, type GameState } from "@ludo/engine";
import { seatFinish } from "../src/lib/seatFinish";

function game(colors: ("red" | "yellow" | "green" | "blue")[]): GameState {
  return createGame(colors.map((color, i) => ({ id: `p${i + 1}`, userId: `u${i + 1}`, color })));
}

/** Put `ids` in the finishing order, as applyMove does when they come home. */
function finish(state: GameState, ...ids: string[]): GameState {
  return { ...state, finishedOrder: [...state.finishedOrder, ...ids], winnerPlayerId: state.winnerPlayerId ?? ids[0]! };
}

describe("seatFinish", () => {
  it("leaves a seat still racing when someone else wins", () => {
    // Red wins a four-way; yellow is mid-race and must not be interrupted.
    const s = finish(game(["red", "yellow", "green", "blue"]), "p1");
    const yellow = seatFinish(s, "yellow");
    expect(yellow.stillPlaying).toBe(true);
    expect(yellow.placed).toBe(false);
    expect(yellow.place).toBe(-1);
  });

  it("marks the champion done the moment they come home", () => {
    const s = finish(game(["red", "yellow", "green", "blue"]), "p1");
    const red = seatFinish(s, "red");
    expect(red.stillPlaying).toBe(false);
    expect(red.placed).toBe(true);
    expect(red.place).toBe(0);
  });

  it("marks a minor place done — 2nd is finished, not still racing", () => {
    const s = finish(game(["red", "yellow", "green", "blue"]), "p1", "p2");
    expect(seatFinish(s, "yellow")).toMatchObject({ place: 1, stillPlaying: false, placed: true });
    expect(seatFinish(s, "green")).toMatchObject({ place: -1, stillPlaying: true, placed: false });
  });

  it("counts both seats done in a 2-player game, where the win ends the match", () => {
    // The engine places the loser in the same update (endIfComplete).
    const s = finish(game(["red", "yellow"]), "p1", "p2");
    expect(seatFinish(s, "red").stillPlaying).toBe(false);
    expect(seatFinish(s, "yellow").stillPlaying).toBe(false);
    expect(seatFinish(s, "yellow").placed).toBe(true);
  });

  it("treats a seat that walked out as done racing", () => {
    const base = game(["red", "yellow", "green"]);
    const s = { ...base, players: base.players.map((p) => (p.color === "green" ? { ...p, hasLeft: true } : p)) };
    const green = seatFinish(s, "green");
    expect(green.stillPlaying).toBe(false);
    // Walking out is not a placement — there is no banked place to read.
    expect(green.placed).toBe(false);
  });

  it("has no local seat in pass & play, so the device is never mid-race", () => {
    const s = finish(game(["red", "yellow", "green"]), "p1");
    const none = seatFinish(s, undefined);
    expect(none.seat).toBeNull();
    expect(none.stillPlaying).toBe(false);
    expect(none.placed).toBe(false);
  });
});
