/**
 * Local forced-action pacing: after a human rolls, a turn with no legal moves
 * auto-passes (paused so the die stays readable), and a turn with a single
 * legal move auto-plays it as soon as the die lands. Local games never hand a
 * human's seat to the bot on idle — the human takes as long as they like — so
 * there is no turn clock to test here (idle-out-to-bot lives only online).
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { useGameStore } from "../src/store/gameStore";

const store = useGameStore;

afterEach(() => {
  store.getState().leaveGame();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("forced-action pacing", () => {
  it("does not hand an idle human's seat to the bot, however long they wait", () => {
    vi.useFakeTimers();
    store.getState().newLocalGame({ players: 2, bots: 1 }); // p1 human, p2 bot

    // Well past any old 30s clock: the human seat stays on the human, waiting.
    vi.advanceTimersByTime(120_000);
    expect(store.getState().state!.currentTurnPlayerId).toBe("p1");
    expect(store.getState().state!.phase).toBe("awaiting-roll");
    expect(store.getState().state!.status).toBe("active");
  });

  it("waits out the die tumble plus a beat before auto-passing a no-move roll", () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // roll = 1 → nothing can leave the yard
    vi.useFakeTimers();
    store.getState().newLocalGame({ players: 2, bots: 1 });

    store.getState().roll();
    expect(store.getState().validMoves).toHaveLength(0);

    // Tumble runs ~700ms; the number must stay on screen well past it.
    vi.advanceTimersByTime(900);
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

    // Not before the tumble settles (~700ms)…
    vi.advanceTimersByTime(500);
    expect(store.getState().state!.currentTurnPlayerId).toBe("p1");
    expect(store.getState().state!.phase).toBe("awaiting-move");

    // …but immediately after it, with no extra reading pause.
    vi.advanceTimersByTime(200);
    expect(store.getState().state!.currentTurnPlayerId).toBe("p2");
  });
});
