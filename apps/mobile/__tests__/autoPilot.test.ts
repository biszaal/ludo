/**
 * vs-AI autopilot: when the human idles out the 30s turn clock, the bot takes
 * over their seat until they tap their avatar (takeControl). Also covers the
 * forced-action pacing: a no-move roll must stay readable (~2s) before passing.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { createSeededRng } from "@ludo/engine";
import { TURN_SECONDS, useGameStore } from "../src/store/gameStore";

const store = useGameStore;

afterEach(() => {
  store.getState().leaveGame();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("vs-AI autopilot", () => {
  it("hands the idle human's seat to the bot when the turn clock expires", () => {
    const rng = createSeededRng(7);
    vi.spyOn(Math, "random").mockImplementation(() => rng());
    vi.useFakeTimers();

    store.getState().newLocalGame({ players: 2, bots: 1 }); // p1 human, p2 bot
    expect(store.getState().autoPilot).toBe(false);

    vi.advanceTimersByTime(TURN_SECONDS * 1000);
    expect(store.getState().autoPilot).toBe(true);

    // With the seat on autopilot, the whole game plays out with no input.
    for (let i = 0; i < 200_000 && store.getState().state!.status === "active"; i++) {
      vi.advanceTimersByTime(700);
    }
    expect(store.getState().state!.status).toBe("finished");
  });

  it("returns the seat to the human on takeControl and stops acting for them", () => {
    vi.useFakeTimers();
    store.getState().newLocalGame({ players: 2, bots: 1 });

    vi.advanceTimersByTime(TURN_SECONDS * 1000); // idle out the first turn
    expect(store.getState().autoPilot).toBe(true);

    store.getState().takeControl();
    expect(store.getState().autoPilot).toBe(false);

    // The pending bot step must not act on the reclaimed seat, and the fresh
    // 30s clock hasn't expired — the game waits for the human.
    vi.advanceTimersByTime(5000);
    expect(store.getState().autoPilot).toBe(false);
    expect(store.getState().state!.currentTurnPlayerId).toBe("p1");
    expect(store.getState().state!.phase).toBe("awaiting-roll");
  });

  it("keeps the human in control when they act before the clock expires", () => {
    vi.useFakeTimers();
    store.getState().newLocalGame({ players: 2, bots: 1 });

    vi.advanceTimersByTime(TURN_SECONDS * 1000 - 1000);
    store.getState().roll(); // manual action restarts the clock
    vi.advanceTimersByTime(1000); // past the original deadline
    expect(store.getState().autoPilot).toBe(false);
  });
});

describe("forced-action pacing", () => {
  it("waits out the die tumble plus a beat before auto-passing a no-move roll", () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // roll = 1 → nothing can leave the yard
    vi.useFakeTimers();
    store.getState().newLocalGame({ players: 2, bots: 1 });

    store.getState().roll();
    expect(store.getState().validMoves).toHaveLength(0);

    // Tumble runs ~950ms; the number must stay on screen well past it.
    vi.advanceTimersByTime(1400);
    expect(store.getState().state!.currentTurnPlayerId).toBe("p1");

    vi.advanceTimersByTime(200);
    expect(store.getState().state!.currentTurnPlayerId).toBe("p2");
  });

  it("plays a lone legal move as soon as the die lands", () => {
    const rolls = [0.99, 0.2]; // a 6 to leave the yard, then a 2
    let call = 0;
    vi.spyOn(Math, "random").mockImplementation(() => rolls[Math.min(call++, rolls.length - 1)]!);
    vi.useFakeTimers();
    store.getState().newLocalGame({ players: 2, bots: 1 });

    store.getState().roll(); // 6 — every yarded token offers an entry move
    store.getState().selectToken(store.getState().validMoves[0]!.tokenId);
    store.getState().roll(); // rolled again on the 6: a 2 — only the entered token can move
    expect(store.getState().validMoves).toHaveLength(1);

    // Not before the tumble settles (~950ms)…
    vi.advanceTimersByTime(900);
    expect(store.getState().state!.currentTurnPlayerId).toBe("p1");
    expect(store.getState().state!.phase).toBe("awaiting-move");

    // …but immediately after it, with no extra reading pause.
    vi.advanceTimersByTime(200);
    expect(store.getState().state!.currentTurnPlayerId).toBe("p2");
  });
});
