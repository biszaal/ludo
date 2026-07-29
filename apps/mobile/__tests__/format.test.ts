/**
 * Currency display maths. The truncation rule is load-bearing: a pill that
 * rounds 9,999 up to "10K" overstates what the player can spend.
 */

import { describe, expect, it } from "vitest";
import { formatCompact, formatExact } from "../src/lib/format";

describe("formatCompact", () => {
  it("shows small balances exactly", () => {
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(1)).toBe("1");
    expect(formatCompact(999)).toBe("999");
  });

  it("compacts thousands with one truncated decimal", () => {
    expect(formatCompact(1000)).toBe("1K");
    expect(formatCompact(1049)).toBe("1K");
    expect(formatCompact(1050)).toBe("1K"); // 1.05 truncates to 1.0 → "1K"
    expect(formatCompact(1100)).toBe("1.1K");
    expect(formatCompact(1234)).toBe("1.2K");
    expect(formatCompact(347750)).toBe("347.7K");
  });

  it("never rounds up past what the player has", () => {
    expect(formatCompact(9999)).toBe("9.9K");
    expect(formatCompact(999999)).toBe("999.9K");
    expect(formatCompact(1999999)).toBe("1.9M");
  });

  it("compacts millions and billions", () => {
    expect(formatCompact(1_000_000)).toBe("1M");
    expect(formatCompact(3_500_000)).toBe("3.5M");
    expect(formatCompact(1_234_567)).toBe("1.2M");
    expect(formatCompact(2_000_000_000)).toBe("2B");
  });

  it("drops trailing .0", () => {
    expect(formatCompact(2000)).toBe("2K");
    expect(formatCompact(5_000_000)).toBe("5M");
  });

  it("is defensive about null and negatives", () => {
    expect(formatCompact(null)).toBe("0");
    expect(formatCompact(undefined)).toBe("0");
    expect(formatCompact(Number.NaN)).toBe("0");
    expect(formatCompact(-1234)).toBe("-1.2K");
  });
});

describe("formatExact", () => {
  it("adds thousands separators", () => {
    expect(formatExact(0)).toBe("0");
    expect(formatExact(999)).toBe("999");
    expect(formatExact(1000)).toBe("1,000");
    expect(formatExact(347750)).toBe("347,750");
    expect(formatExact(1234567)).toBe("1,234,567");
  });

  it("is defensive about null and negatives", () => {
    expect(formatExact(null)).toBe("0");
    expect(formatExact(-1234)).toBe("-1,234");
  });
});
