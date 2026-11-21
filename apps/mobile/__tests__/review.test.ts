import { describe, expect, it } from "vitest";
import { REVIEW_GAP_MS, REVIEW_MIN_GAMES, shouldAskForReview } from "../src/lib/review";

const now = Date.UTC(2026, 10, 21, 12);
const base = { won: true, gamesPlayed: REVIEW_MIN_GAMES, lastAskedAt: null, now };

describe("shouldAskForReview", () => {
  it("asks after a win from the third finished game", () => {
    expect(shouldAskForReview(base)).toBe(true);
  });

  it("never asks after a loss", () => {
    expect(shouldAskForReview({ ...base, won: false })).toBe(false);
  });

  it("waits for three finished games", () => {
    expect(shouldAskForReview({ ...base, gamesPlayed: REVIEW_MIN_GAMES - 1 })).toBe(false);
  });

  it("asks at most once per 90 days", () => {
    expect(shouldAskForReview({ ...base, lastAskedAt: now - REVIEW_GAP_MS + 1 })).toBe(false);
    expect(shouldAskForReview({ ...base, lastAskedAt: now - REVIEW_GAP_MS })).toBe(true);
    expect(REVIEW_GAP_MS).toBe(90 * 24 * 60 * 60 * 1000);
  });
});
