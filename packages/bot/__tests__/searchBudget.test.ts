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
 * The threshold below is half that soft limit, scored on the machine where a
 * run measured ~23ms. It is several times looser than the work, so it catches
 * a search that has become many times more expensive. A sequential CI run
 * still reported 100.04ms of process CPU against the 100ms line, because that
 * runner's core is slower. The figure compared with the threshold is the
 * median of several thread-CPU samples, divided by how much slower this core
 * is than that machine. The divisor is a fixed integer loop that does not
 * call the bot: a slower core stretches the loop and the search together,
 * and a heavier search moves only the search.
 */

import { cpuUsage } from "node:process";
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

/**
 * Thread CPU clock for the budget sample. `threadCpuUsage` times the calling
 * thread; `cpuUsage` covers runtimes that only expose the process clock.
 */
class SearchBudget {
  /**
   * Cost of {@link calibrate} on a core where a 24-action run takes the ~23ms
   * quoted above.
   *
   * Local steady-state medians (thread CPU, 5 samples after a warmup pass):
   * per-run search 80.13ms, calibration 99.98ms.
   * `99.981 * (23 / 80.12676) = 28.699`, so that run scores as 23ms.
   */
  static readonly referenceCalibrationMs = 28.699;

  /**
   * Stop a runaway calibration from widening the allowance without limit.
   * 16× still sits under an order-of-magnitude search regression: healthy
   * work scores near 23ms, and 10× that work scores near 230ms.
   */
  static readonly factorCap = 16;

  /** Median of this many steady-state samples. One warmup pass is discarded. */
  static readonly sampleCount = 5;

  /** Written by the calibration loop so the loop stays observable. */
  static sink = 0;

  static readCpu(previous?: NodeJS.CpuUsage): NodeJS.CpuUsage {
    if (typeof process.threadCpuUsage === "function") {
      return previous ? process.threadCpuUsage(previous) : process.threadCpuUsage();
    }
    return previous ? cpuUsage(previous) : cpuUsage();
  }

  static measure(work: () => void): number {
    const start = this.readCpu();
    work();
    const elapsed = this.readCpu(start);
    return (elapsed.user + elapsed.system) / 1_000;
  }

  static median(samples: number[]): number {
    const sorted = [...samples].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  }

  /** Discard one warmup pass, then take the median of `runs` samples. */
  static steady(work: () => void, runs: number): { median: number; samples: number[] } {
    work();
    const samples = Array.from({ length: runs }, () => this.measure(work));
    return { median: this.median(samples), samples };
  }

  /**
   * Fixed integer work, the same count every run. A heavier search leaves it
   * alone. A slower core stretches it in step with the search.
   */
  static calibrate(): { median: number; samples: number[] } {
    const burn = () => {
      let x = 0x12345678;
      for (let i = 0; i < 80_000_000; i++) x = (Math.imul(x, 1664525) + 1013904223) | 0;
      SearchBudget.sink = x;
    };
    return this.steady(burn, this.sampleCount);
  }

  /**
   * How many times slower this core is than the reference core. Floored at 1
   * so a faster core keeps the written 100ms ceiling, and capped at
   * {@link factorCap}.
   */
  static factor(calibrationMs: number): number {
    if (!(calibrationMs > 0)) throw new Error("CPU calibration did not advance");
    const raw = calibrationMs / this.referenceCalibrationMs;
    return Math.min(this.factorCap, Math.max(1, raw));
  }

  /** Per-run milliseconds expressed on the reference core. */
  static normalizedRunMs(perRunMs: number, calibrationMs: number): number {
    return perRunMs / this.factor(calibrationMs);
  }
}

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
    const decide = () => {
      for (const [st, pid, moves] of points) chooseMove(st, pid, moves, { rng });
    };

    // The discarded pass inside `steady` brings the search to steady state.
    const timed = SearchBudget.steady(decide, SearchBudget.sampleCount);
    const perRunSamples = timed.samples.map((ms) => (ms / points.length) * ACTIONS_PER_RUN);
    const perRunMs = SearchBudget.median(perRunSamples);
    const calibration = SearchBudget.calibrate();
    const factor = SearchBudget.factor(calibration.median);
    const normalized = SearchBudget.normalizedRunMs(perRunMs, calibration.median);
    if (SearchBudget.sink === 0) throw new Error("calibration loop was deleted");

    // ~23ms on the reference core. The 100ms line is half the soft CPU limit.
    expect(
      normalized,
      `normalized ${normalized.toFixed(2)}ms from per-run median ${perRunMs.toFixed(2)}ms ` +
        `[${perRunSamples.map((ms) => ms.toFixed(2)).join(", ")}], ` +
        `calibration ${calibration.median.toFixed(2)}ms, factor ${factor.toFixed(2)}`,
    ).toBeLessThan(SOFT_CPU_LIMIT_MS / 2);
  }, 60_000);

  it("costs strictly less at depth 1, so the dial is there if CPU ever tightens", () => {
    const points = decisionPoints(4, 400);
    const rng = createSeededRng(1);
    for (const [st, pid, moves] of points.slice(0, 100)) chooseMove(st, pid, moves, { rng });

    const time = (depth: number) => {
      const start = cpuUsage();
      for (const [st, pid, moves] of points) chooseMove(st, pid, moves, { rng, depth });
      const elapsed = cpuUsage(start);
      return (elapsed.user + elapsed.system) / 1_000;
    };
    time(1); // warm both paths before measuring either
    time(2);
    expect(time(1)).toBeLessThan(time(2));
  }, 60_000);
});
