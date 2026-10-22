/**
 * Tests the store's bot auto-play loop. With both seats as bots, advancing the
 * fake timer should drive the whole game to completion with no human input.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { createSeededRng, getValidMoves, type GameState } from "@ludo/engine";
import { useGameStore } from "../src/store/gameStore";
import { dieHandoverMs } from "../src/lib/moveTiming";
import { setMeasuredSoundLead } from "../src/lib/soundSync";

const store = useGameStore;

afterEach(() => {
  store.getState().leaveGame();
  setMeasuredSoundLead(null);
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

  /**
   * The same race the autopilot had (autopilotDie.test), in vs-AI. After a
   * human's move the die stays at the human's corner until their pawn lands
   * (useDieHandover), but the bot rolled a fixed BOT_DELAY later. A walk longer
   * than that meant the roll began with the die across the board; it then
   * jumped to the bot's corner as a freshly mounted Dice and the tumble never
   * showed. Reported 2026-10-09 on iPhone: "die roll animation not showing
   * sometimes".
   */
  it("lets the die reach the bot's corner before the bot rolls it", () => {
    vi.useFakeTimers();
    // A phone whose sound arrives late pre-rolls the pawn, which is what makes
    // an ordinary five-cell walk outlast BOT_DELAY. A capture does the same.
    setMeasuredSoundLead(400);

    store.getState().newLocalGame({ players: 2, bots: 1 });
    const dealt = store.getState().state!;
    const human = dealt.players[0]!;
    const pawn = `${human.color}-0`;
    const before: GameState = {
      ...dealt,
      currentTurnPlayerId: human.id,
      phase: "awaiting-move",
      diceValue: 5,
      tokens: dealt.tokens.map((t) => (t.id === pawn ? { ...t, position: { type: "track", index: 10 } } : t)),
    };
    store.setState({ state: before, validMoves: getValidMoves(before, human.id) });

    store.getState().selectToken(pawn);
    const after = store.getState().state!;
    expect(after.currentTurnPlayerId).not.toBe(human.id);
    const handover = dieHandoverMs(before, after);
    expect(handover).toBeGreaterThan(900); // longer than BOT_DELAY: the racing case
    const seq = store.getState().rollSeq;

    // The die is still at the human's corner: the bot must not have rolled.
    vi.advanceTimersByTime(handover - 50);
    expect(store.getState().rollSeq).toBe(seq);

    // It has arrived, and a beat later the bot rolls it.
    vi.advanceTimersByTime(1000);
    expect(store.getState().rollSeq).toBe(seq + 1);
  });
});
