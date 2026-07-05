/**
 * Stats store: totals accumulate per mode, duplicate ids are ignored, and the
 * history list stays capped while totals keep counting.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useStats, type MatchRecord } from "../src/store/statsStore";

function rec(id: string, over: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id,
    mode: "ai",
    finishedAt: Date.now(),
    players: 2,
    winnerLabel: "You",
    winnerColor: "red",
    didWin: true,
    ...over,
  };
}

beforeEach(() => {
  useStats.getState().reset();
});

describe("stats store", () => {
  it("accumulates totals per mode", () => {
    useStats.getState().record(rec("a"));
    useStats.getState().record(rec("b", { didWin: false }));
    useStats.getState().record(rec("c", { mode: "pass", didWin: null }));

    const t = useStats.getState().totals;
    expect(t.ai).toEqual({ played: 2, won: 1 });
    expect(t.pass).toEqual({ played: 1, won: 0 });
    expect(t.online).toEqual({ played: 0, won: 0 });
    expect(useStats.getState().recent).toHaveLength(3);
    expect(useStats.getState().recent[0]!.id).toBe("c"); // newest first
  });

  it("ignores duplicate record ids", () => {
    useStats.getState().record(rec("same"));
    useStats.getState().record(rec("same"));
    expect(useStats.getState().totals.ai.played).toBe(1);
  });

  it("caps history at 30 while totals keep counting", () => {
    for (let i = 0; i < 35; i++) useStats.getState().record(rec(`g${i}`));
    expect(useStats.getState().recent).toHaveLength(30);
    expect(useStats.getState().totals.ai.played).toBe(35);
    expect(useStats.getState().recent[0]!.id).toBe("g34");
  });
});
