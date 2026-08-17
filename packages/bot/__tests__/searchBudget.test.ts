/**
 * CPU guard rail for the searching bot tier.
 *
 * The server drives bots inside a background task on a Supabase Edge Function
 * isolate, which has a 200ms SOFT CPU limit: crossing it retires the isolate,
 * so the next player's request pays a cold start. The bot is therefore not
 * spending its own budget — it is spending everyone's latency.
 *
 * One `driveBotTurns` run is capped at BOT_MAX_ACTIONS * 3 = 24 actions, so the
 * number that matters is 24 x per-decision cost. Measured ~948µs per decision
 * at a four-player midgame, i.e. ~23ms per run.
 *
 * The threshold below is deliberately an order of magnitude looser than the
 * measurement. This is a timing test on unknown hardware; it is here to catch
 * "someone made the search 50x more expensive", not to police a 20% drift.
 */

import { describe, it, expect } from "vitest";
import {
  applyMove,
  createGame,
  createSeededRng,
  endTurn,
  getValidMoves,
  rollDice,
  type GameState,
  type Move,
} from "@ludo/engine";
import { chooseMove } from "../src/index.js";

const COLORS = ["red", "green", "yellow", "blue"] as const;

/** Mirrors BOT_MAX_ACTIONS * 3 in supabase/functions/game/bots.ts. */
const ACTIONS_PER_RUN = 24;
/** The edge runtime's soft CPU limit, which we must stay comfortably under. */
const SOFT_CPU_LIMIT_MS = 200;

/** Real decision points harvested from played games, not synthetic positions. */
function decisionPoints(n: number, count: number): [GameState, string, Move[]][] {
  const points: [GameState, string, Move[]][] = [];
  for (let seed = 1; points.length < count; seed++) {
    let st = createGame(
      Array.from({ length: n }, (_, i) => ({ id: `p${i}`, userId: `u${i}`, color: COLORS[i]! })),
      { gameId: `budget-${seed}` },
    );
    const rng = createSeededRng(seed);
    for (let s = 0; s < 20_000 && st.status === "active" && points.length < count; s++) {
      if (st.phase === "awaiting-roll") {
        st = rollDice(st, rng).newState;
        continue;
      }
      const pid = st.currentTurnPlayerId;
      const moves = getValidMoves(st, pid);
      // Only branching positions cost anything to think about.
      if (moves.length > 1) points.push([st, pid, moves]);
      st =
        moves.length === 0
          ? endTurn(st)
          : applyMove(st, chooseMove(st, pid, moves, { rng, difficulty: "normal" }));
    }
  }
  return points;
}

describe("search CPU budget", () => {
  it("keeps a full 24-action bot run far inside the edge runtime's soft CPU limit", () => {
    const points = decisionPoints(4, 600);
    const rng = createSeededRng(1);

    // Warm up so the measurement is of steady-state code, not the JIT.
    for (const [st, pid, moves] of points.slice(0, 100)) chooseMove(st, pid, moves, { rng });

    const start = performance.now();
    for (const [st, pid, moves] of points) chooseMove(st, pid, moves, { rng });
    const perDecisionMs = (performance.now() - start) / points.length;
    const perRunMs = perDecisionMs * ACTIONS_PER_RUN;

    // ~23ms measured; fail only on a change of a different order.
    expect(perRunMs).toBeLessThan(SOFT_CPU_LIMIT_MS / 2);
  }, 60_000);

  it("costs strictly less at depth 1, so the dial is there if CPU ever tightens", () => {
    const points = decisionPoints(4, 400);
    const rng = createSeededRng(1);
    for (const [st, pid, moves] of points.slice(0, 100)) chooseMove(st, pid, moves, { rng });

    const time = (depth: number) => {
      const start = performance.now();
      for (const [st, pid, moves] of points) chooseMove(st, pid, moves, { rng, depth });
      return performance.now() - start;
    };
    time(1); // warm both paths before measuring either
    time(2);
    expect(time(1)).toBeLessThan(time(2));
  }, 60_000);
});
