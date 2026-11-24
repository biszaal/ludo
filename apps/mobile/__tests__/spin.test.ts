/**
 * Reward spin, app side: what the Home tile shows, the odds list, the
 * countdown, and where the wheel stops. The server decides every prize; these
 * only present what it said.
 */
import { describe, it, expect } from "vitest";
import { flapperTilt, formatCountdown, msUntilReset, odds, rimMetal, tileTickMs, tileView, wedgeFills, wheelTarget, type Segment, type SpinState } from "../src/lib/spin";

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

describe("msUntilReset", () => {
  it("is the time left to the reset, never negative, and null when there is nothing to count", () => {
    expect(msUntilReset(state({ first: "locked", daily: false, match: 0 }), NOW)).toBe(12 * 60 * 60 * 1000);
    expect(msUntilReset(state({ first: "locked", daily: false, match: 0 }), Date.parse("2026-11-23T00:01:00Z"))).toBe(0);
    expect(msUntilReset(null, NOW)).toBeNull();
    expect(msUntilReset({ enabled: false }, NOW)).toBeNull();
  });
});

describe("tileTickMs", () => {
  it("ticks once a minute, wakes just after a reset that is near, and backs off to a minute once it has passed", () => {
    expect(tileTickMs(5 * 60 * 60 * 1000)).toBe(60_000);
    expect(tileTickMs(30_000)).toBe(31_000);
    expect(tileTickMs(0)).toBe(60_000);
  });
});

describe("wedgeFills", () => {
  it("gives the top coin prize the gold wedge and alternates ivory and navy around it", () => {
    expect(wedgeFills(BRONZE)).toEqual(["ivory", "navy", "ivory", "navy", "ivory", "navy", "ivory", "navy", "gold"]);
    const first: Segment[] = [{ coins: 100, w: 400 }, { coins: 150, w: 300 }, { coins: 200, w: 200 }, { gems: 5, w: 80 }, { coins: 500, w: 20 }];
    expect(wedgeFills(first)).toEqual(["ivory", "navy", "ivory", "navy", "gold"]);
  });

  it("picks the first of two equal top prizes, and no gold when there are no coin prizes", () => {
    expect(wedgeFills([{ coins: 500, w: 1 }, { coins: 100, w: 1 }, { coins: 500, w: 1 }])).toEqual(["gold", "ivory", "navy"]);
    expect(wedgeFills([{ gems: 2, w: 1 }, { gems: 5, w: 1 }])).toEqual(["ivory", "navy"]);
  });
});

describe("rimMetal", () => {
  it("matches the wheel's tier, with the first-game wheel in gold and anything unknown in silver", () => {
    expect(rimMetal("bronze")).toBe("bronze");
    expect(rimMetal("silver")).toBe("silver");
    expect(rimMetal("gold")).toBe("gold");
    expect(rimMetal("firstGame")).toBe("gold");
    expect(rimMetal("weekly")).toBe("silver");
  });
});

describe("flapperTilt", () => {
  it("stands upright over the middle of a wedge", () => {
    expect(flapperTilt(0, 8)).toBe(0);
    expect(flapperTilt(wheelTarget(3, 8, 0, 5), 8)).toBe(0);
  });

  it("is pushed over by a peg coming up to the pointer, and drops back once it has passed", () => {
    const justBefore = flapperTilt(20.5, 8); // the peg is 2 degrees short of the pointer
    expect(justBefore).toBeLessThan(-10);
    expect(justBefore).toBeGreaterThanOrEqual(-14);
    expect(flapperTilt(23.5, 8)).toBe(0); // 1 degree past it
  });

  it("works for any rotation, negative or many turns on", () => {
    expect(flapperTilt(20.5 - 360 * 3, 8)).toBeCloseTo(flapperTilt(20.5, 8));
    expect(flapperTilt(20.5 + 360 * 7, 8)).toBeCloseTo(flapperTilt(20.5, 8));
  });
});
