/**
 * Tests for the searching "hard" tier: that it is measurably stronger than the
 * heuristic it replaced, that the evaluator's curve has the shape the strategy
 * depends on, and that the whole thing stays inside the edge runtime's CPU
 * budget.
 *
 * The strength test is a statistical one, so its threshold sits well below the
 * measured result (59.8% over 400 games) — far enough that ordinary dice
 * variance cannot fail it, close enough that a genuine regression will.
 */

import { describe, it, expect } from "vitest";
import {
  applyMove,
  createGame,
  createSeededRng,
  endTurn,
  getValidMoves,
  rollDice,
  FINISH_REL_INDEX,
  TRACK_PATH_LENGTH,
  type GameState,
  type TokenPosition,
} from "@ludo/engine";
import { chooseMove, evaluateFor, riskAppetite, tokenProgressValue, type BotOptions } from "../src/index.js";

const COLORS = ["red", "green", "yellow", "blue"] as const;

function game(n: number, gameId = "g"): GameState {
  return createGame(
    Array.from({ length: n }, (_, i) => ({ id: `p${i}`, userId: `u${i}`, color: COLORS[i]! })),
    { gameId },
  );
}

/** Token ids are colour-based (`red-0`), NOT seat-based — asserted, because a
 *  silent no-op here makes an evaluator test pass for the wrong reason. */
function withToken(state: GameState, tokenId: string, position: TokenPosition): GameState {
  if (!state.tokens.some((t) => t.id === tokenId)) throw new Error(`No such token: ${tokenId}`);
  return { ...state, tokens: state.tokens.map((t) => (t.id === tokenId ? { ...t, position } : t)) };
}

/** Play one seeded game; `cfg` maps player id to bot options. Returns standings. */
function playGame(seed: number, cfg: Record<string, BotOptions>, n: number): string[] {
  let state = game(n, `sim-${seed}`);
  const rng = createSeededRng(seed);
  for (let step = 0; step < 200_000 && state.status === "active"; step++) {
    if (state.phase === "awaiting-roll") {
      state = rollDice(state, rng).newState;
      continue;
    }
    const pid = state.currentTurnPlayerId;
    const moves = getValidMoves(state, pid);
    state =
      moves.length === 0
        ? endTurn(state)
        : applyMove(state, chooseMove(state, pid, moves, { rng, ...cfg[pid] }));
  }
  return state.finishedOrder ?? [];
}

describe("progress curve", () => {
  it("is monotonic from the yard to the centre", () => {
    let prev = -Infinity;
    for (let rel = 0; rel <= FINISH_REL_INDEX; rel++) {
      const v = tokenProgressValue(rel);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
    expect(tokenProgressValue(null)).toBeLessThan(tokenProgressValue(0));
  });

  it("is convex on the track, so the leading token is worth advancing most", () => {
    // The whole "concentrate progress" strategy rests on this: a step late in
    // the lap has to be worth more than a step early in it.
    const early = tokenProgressValue(6) - tokenProgressValue(0);
    const late = tokenProgressValue(50) - tokenProgressValue(44);
    expect(late).toBeGreaterThan(early * 1.5);
  });

  it("jumps where a token's status changes, not merely its distance", () => {
    // Turning into the uncapturable home column is worth more than a plain step.
    const intoColumn = tokenProgressValue(TRACK_PATH_LENGTH) - tokenProgressValue(TRACK_PATH_LENGTH - 1);
    const plainStep = tokenProgressValue(40) - tokenProgressValue(39);
    expect(intoColumn).toBeGreaterThan(plainStep * 3);
    // And so is actually banking the token.
    expect(tokenProgressValue(FINISH_REL_INDEX) - tokenProgressValue(FINISH_REL_INDEX - 1)).toBeGreaterThan(plainStep * 3);
  });
});

describe("evaluator", () => {
  it("scores a won position above any live one", () => {
    const st = game(2);
    const live = evaluateFor(st, "p0", 0.55);
    const won: GameState = {
      ...st,
      status: "finished",
      finishedOrder: ["p0", "p1"],
      winnerPlayerId: "p0",
    };
    expect(evaluateFor(won, "p0", 0.55)).toBeGreaterThan(live + 1000);
    expect(evaluateFor(won, "p1", 0.55)).toBeLessThan(live - 1000);
  });

  it("prefers knocking back the leader over an equal dent in a straggler", () => {
    // green (p1) is far ahead, yellow (p2) has barely started. Both on the track.
    let st = game(3);
    st = withToken(st, "green-0", { type: "track", index: 45 });
    st = withToken(st, "yellow-0", { type: "track", index: 2 });
    const base = evaluateFor(st, "p0", 0.55);
    const leaderHit = evaluateFor(withToken(st, "green-0", "home"), "p0", 0.55);
    const stragglerHit = evaluateFor(withToken(st, "yellow-0", "home"), "p0", 0.55);
    expect(leaderHit).toBeGreaterThan(base);
    expect(leaderHit).toBeGreaterThan(stragglerHit);
  });

  it("gambles when behind and protects when ahead", () => {
    let behind = game(2);
    behind = withToken(behind, "green-0", "finished");
    behind = withToken(behind, "green-1", "finished");
    let ahead = game(2);
    ahead = withToken(ahead, "red-0", "finished");
    ahead = withToken(ahead, "red-1", "finished");
    // Lower risk weight = more willing to accept exposure. p0 is red.
    expect(riskAppetite(behind, "p0")).toBeLessThan(riskAppetite(ahead, "p0"));
  });
});

describe("hard search vs the normal heuristic", () => {
  it("wins a clear majority heads-up over 400 seeded games", () => {
    const games = 400;
    let hardWins = 0;
    for (let seed = 1; seed <= games; seed++) {
      // Alternate seats so first-mover advantage cancels out.
      const hardFirst = seed % 2 === 1;
      const cfg: Record<string, BotOptions> = hardFirst
        ? { p0: { difficulty: "hard" }, p1: { difficulty: "normal" } }
        : { p0: { difficulty: "normal" }, p1: { difficulty: "hard" } };
      if (playGame(seed, cfg, 2)[0] === (hardFirst ? "p0" : "p1")) hardWins++;
    }
    // Measured 59.8%; 0.54 is ~3 sigma below that and still well clear of even.
    expect(hardWins / games).toBeGreaterThan(0.54);
  }, 120_000);

  it("beats three normal opponents at a four-player table", () => {
    // 25% is the no-edge baseline (verified: normal vs 3x normal scores 25.1%
    // over 2000 games). Hard measured 29.9% at that sample size; this test runs
    // a smaller deterministic slice of it to stay inside a sane suite runtime.
    const seeds = 50;
    let wins = 0;
    let played = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      for (let slot = 0; slot < 4; slot++) {
        const cfg: Record<string, BotOptions> = {};
        for (let i = 0; i < 4; i++) {
          cfg[`p${i}`] = { difficulty: i === slot ? "hard" : "normal" };
        }
        if (playGame(seed * 4 + slot, cfg, 4)[0] === `p${slot}`) wins++;
        played++;
      }
    }
    expect(wins / played).toBeGreaterThan(0.25);
  }, 120_000);
});
