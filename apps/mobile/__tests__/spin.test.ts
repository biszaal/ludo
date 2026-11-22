/**
 * Reward spin, app side: what the Home tile shows, the odds list, the
 * countdown, and where the wheel stops. The server decides every prize; these
 * only present what it said.
 */
import { describe, it, expect } from "vitest";
import { formatCountdown, odds, tileView, wheelTarget, type Segment, type SpinState } from "../src/lib/spin";

const NOW = Date.parse("2026-11-22T12:00:00Z");
const RESET = "2026-11-23T00:00:00Z";
const BRONZE: Segment[] = [
  { coins: 25, w: 280 }, { coins: 50, w: 300 }, { coins: 75, w: 150 },
  { coins: 100, w: 120 }, { coins: 150, w: 70 }, { gems: 2, w: 50 },
  { coins: 250, w: 25 }, { coins: 500, w: 4 }, { coins: 1000, w: 1 },
];
const state = (owed: NonNullable<SpinState["owed"]>, resetsAt = RESET): SpinState => ({
  enabled: true,
  owed,
  matchMax: 3,
  tier: "bronze",
  next: null,
  resetsAt,
});

describe("tileView", () => {
  it("is hidden when there is no state or the feature is off", () => {
    expect(tileView(null, NOW)).toEqual({ kind: "hidden" });
    expect(tileView({ enabled: false }, NOW)).toEqual({ kind: "hidden" });
  });

  it("counts every spin owed: first + daily + match", () => {
    expect(tileView(state({ first: "owed", daily: true, match: 2 }), NOW)).toEqual({ kind: "ready", count: 4 });
    expect(tileView(state({ first: "used", daily: false, match: 1 }), NOW)).toEqual({ kind: "ready", count: 1 });
  });

  it("is locked when nothing is owed and the first-game spin is still locked", () => {
    expect(tileView(state({ first: "locked", daily: false, match: 0 }), NOW)).toEqual({ kind: "locked" });
  });

  it("counts down to the reset otherwise", () => {
    expect(tileView(state({ first: "used", daily: false, match: 0 }), NOW)).toEqual({
      kind: "countdown",
      ms: 12 * 60 * 60 * 1000,
    });
  });

  it("never gives a negative countdown once the reset has passed", () => {
    const later = Date.parse("2026-11-23T00:05:00Z");
    expect(tileView(state({ first: "used", daily: false, match: 0 }), later)).toEqual({ kind: "countdown", ms: 0 });
  });
});

describe("odds", () => {
  it("turns weights into percentages with at most one decimal", () => {
    expect(odds(BRONZE).map((o) => o.pct)).toEqual(["28%", "30%", "15%", "12%", "7%", "5%", "2.5%", "0.4%", "0.1%"]);
    expect(odds(BRONZE)[5].label).toEqual({ gems: 2, w: 50 });
  });
});

describe("formatCountdown", () => {
  it("rounds minutes up, never below one", () => {
    expect(formatCountdown((4 * 60 + 11) * 60_000 + 30_000)).toEqual({ h: 4, m: 12 });
    expect(formatCountdown(20_000)).toEqual({ h: 0, m: 1 });
    expect(formatCountdown(0)).toEqual({ h: 0, m: 1 });
  });
});

describe("wheelTarget", () => {
  it("puts the segment's centre under the top pointer, whole turns ahead", () => {
    const t = wheelTarget(2, 8, 0, 5);
    expect((t + 2 * 45) % 360).toBe(0);
    expect(t).toBeGreaterThanOrEqual(5 * 360);
    expect(t).toBeLessThan(6 * 360);
  });

  it("works from where the last spin stopped", () => {
    const t = wheelTarget(3, 9, 1890, 5);
    expect((t + 3 * 40) % 360).toBe(0);
    expect(t).toBeGreaterThanOrEqual(1890 + 5 * 360);
    expect(t).toBeLessThan(1890 + 6 * 360);
  });

  it("lands segment 0 on a whole turn", () => {
    expect(wheelTarget(0, 5, 0, 3) % 360).toBe(0);
  });
});
