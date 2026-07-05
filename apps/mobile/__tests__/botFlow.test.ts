/**
 * Tests the store's bot auto-play loop. With both seats as bots, advancing the
 * fake timer should drive the whole game to completion with no human input.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { createSeededRng } from "@ludo/engine";
import { useGameStore } from "../src/store/gameStore";

const store = useGameStore;

afterEach(() => {
  store.getState().leaveGame();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("bot auto-play loop", () => {
  it("plays an all-AI game to completion on the timer", () => {
    const rng = createSeededRng(3);
    vi.spyOn(Math, "random").mockImplementation(() => rng());
    vi.useFakeTimers();

    store.getState().newLocalGame({ players: 2, bots: 2 }); // both seats are bots

    for (let i = 0; i < 200_000 && store.getState().state!.status === "active"; i++) {
      vi.advanceTimersByTime(700);
    }

    expect(store.getState().state!.status).toBe("finished");
    expect(store.getState().message).toContain("wins");
  });

  it("stops the loop and clears timers when leaving", () => {
    vi.useFakeTimers();
    store.getState().newLocalGame({ players: 2, bots: 2 });
    store.getState().leaveGame();
    // No pending bot work should remain to run.
    expect(vi.getTimerCount()).toBe(0);
    expect(store.getState().state).toBeNull();
  });

  it("does not start a bot loop in pure pass-and-play", () => {
    vi.useFakeTimers();
    store.getState().newLocalGame({ players: 2, bots: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });
});
