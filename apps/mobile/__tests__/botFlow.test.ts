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

  /**
   * A busted third six deliberately leaves `state` on the PRE-roll state for
   * BUST_HOLD_MS so the six can be seen landing on the roller's own die. That
   * held state still reads as "this bot's turn, awaiting-roll" — and the bot
   * loop steps every BOT_DELAY, which is shorter than the hold. Nothing may
   * act into that window: rolling again both cancels the pending forfeit and
   * hands the bot the extra turn the rule just took away.
   */
  it("forfeits a bot's turn on three sixes instead of rolling again", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9); // every roll is a 6
    vi.useFakeTimers();

    store.getState().newLocalGame({ players: 2, bots: 2 });

    // Every seat busts on its third roll, so the turn must keep rotating. Under
    // the old behaviour the first bot rolled sixes forever and the seat never
    // moved off p1 at all.
    // ~30s of simulated play. A busting turn costs three BOT_DELAY steps plus
    // the BUST_HOLD_MS pause, so the window has to be several turns wide for
    // "keeps rotating" to mean anything — BOT_DELAY now outlasts the die tumble
    // (a bot used to start moving while its own die was still in the air), so a
    // turn takes noticeably longer than it once did.
    const handOffs: string[] = [];
    for (let i = 0; i < 300; i++) {
      vi.advanceTimersByTime(100);
      const cur = store.getState().state!.currentTurnPlayerId;
      if (cur !== handOffs.at(-1)) handOffs.push(cur);
    }

    expect(handOffs.length).toBeGreaterThan(2);
    expect(new Set(handOffs)).toEqual(new Set(["p1", "p2"]));
  });
});
