/**
 * Pot maths. The 4-player pot used to read half its real value everywhere but
 * the quick-match sheet, so these pin the seat-count scaling.
 */

import { describe, it, expect } from "vitest";
import { canAfford, nextDailyBonus, payoutSplit, potFor } from "../src/lib/economy";

const economy = { dailyBonusBase: 50, streakStep: 25, streakMaxDay: 7 };

describe("nextDailyBonus", () => {
  it("pays the base on a fresh streak", () => {
    expect(nextDailyBonus(0, economy)).toBe(50);
  });

  it("adds a step per banked day", () => {
    expect(nextDailyBonus(3, economy)).toBe(125);
  });

  it("caps at the streak ceiling", () => {
    expect(nextDailyBonus(6, economy)).toBe(200);
    expect(nextDailyBonus(40, economy)).toBe(200);
  });
});

describe("potFor", () => {
  it("pays every seat's entry in a 1v1", () => {
    expect(potFor(100, 2)).toBe(200);
  });

  it("pays every seat's entry at a 4-player table", () => {
    expect(potFor(100, 4)).toBe(400);
  });

  it("is zero for a friendly game", () => {
    expect(potFor(0, 4)).toBe(0);
  });

  it("is zero when the seat count is not yet known", () => {
    expect(potFor(100, 0)).toBe(0);
  });
});

describe("canAfford", () => {
  it("clears an entry the balance covers exactly", () => {
    expect(canAfford(100, 100)).toBe(true);
  });

  it("blocks an entry the balance falls short of", () => {
    expect(canAfford(99, 100)).toBe(false);
  });

  it("treats an unread balance as unaffordable", () => {
    expect(canAfford(null, 100)).toBe(false);
  });

  it("always clears a friendly game, even unread", () => {
    expect(canAfford(null, 0)).toBe(true);
  });
});

describe("payoutSplit", () => {
  it("pays the exact figures the design calls for at the base tier", () => {
    // 4 players staking 100 => 400 pot.
    expect(payoutSplit(100, 4)).toEqual([250, 100, 50]);
    // 3 players staking 100 => 300 pot.
    expect(payoutSplit(100, 3)).toEqual([200, 100]);
    // Heads-up stays winner-take-all — there is no podium to share.
    expect(payoutSplit(100, 2)).toEqual([200]);
  });

  it("always distributes the whole pot, at every stake tier", () => {
    // Nothing may evaporate: the shares are what the seats paid in.
    for (const stake of [100, 1000, 10000]) {
      for (const seats of [2, 3, 4]) {
        const shares = payoutSplit(stake, seats);
        const paid = shares.reduce((a, b) => a + b, 0);
        expect(paid).toBe(potFor(stake, seats));
      }
    }
  });

  it("keeps places strictly descending, so finishing higher always pays more", () => {
    for (const seats of [3, 4]) {
      const shares = payoutSplit(1000, seats);
      for (let i = 1; i < shares.length; i++) {
        expect(shares[i]!).toBeLessThan(shares[i - 1]!);
      }
      expect(shares[shares.length - 1]!).toBeGreaterThan(0);
    }
  });

  it("leaves the last place unpaid — someone has to lose their entry", () => {
    // Paying every seat would make a staked match risk-free and meaningless.
    expect(payoutSplit(100, 4).length).toBe(3);
    expect(payoutSplit(100, 3).length).toBe(2);
  });

  it("never pays out on a friendly (unstaked) game", () => {
    expect(payoutSplit(0, 4)).toEqual([]);
  });

  it("a winner still beats their own entry fee at every table size", () => {
    for (const seats of [2, 3, 4]) {
      expect(payoutSplit(100, seats)[0]!).toBeGreaterThan(100);
    }
  });
});
