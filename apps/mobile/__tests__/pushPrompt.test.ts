/**
 * When the soft notification ask is allowed to show.
 *
 * The OS prompt is one-shot, so the interesting bugs are all in the gate:
 * asking on a second win, asking again the day after a "not now", asking
 * someone who already said yes, asking when the OS has stopped offering.
 * The sheet and `registerForPush` are not in here — they only run when this
 * returns true.
 */

import { describe, expect, it } from "vitest";
import { PushPrompt, type PromptSignals } from "../src/lib/pushPrompt";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 20, 12, 0, 0);

function signals(over: Partial<PromptSignals> = {}): PromptSignals {
  return {
    delight: "claim",
    winsBefore: 0,
    permissionKnown: true,
    granted: false,
    canAskAgain: true,
    pushOn: true,
    remindersOn: true,
    declinedAt: null,
    now: NOW,
    ...over,
  };
}

describe("PushPrompt.shouldOffer", () => {
  it("offers on a daily-chest claim before any win", () => {
    expect(PushPrompt.shouldOffer(signals({ delight: "claim", winsBefore: 0 }))).toBe(true);
  });

  it("offers on the first personal win", () => {
    expect(PushPrompt.shouldOffer(signals({ delight: "first-win", winsBefore: 0 }))).toBe(true);
  });

  it("does not treat a later win as a moment of delight", () => {
    expect(PushPrompt.shouldOffer(signals({ delight: "first-win", winsBefore: 1 }))).toBe(false);
    expect(PushPrompt.shouldOffer(signals({ delight: "first-win", winsBefore: 4 }))).toBe(false);
  });

  it("still offers on a claim after the player already has wins", () => {
    // The claim is the recurring moment. The first win is only special
    // because it can arrive before they have ever opened the chest.
    expect(PushPrompt.shouldOffer(signals({ delight: "claim", winsBefore: 3 }))).toBe(true);
  });

  it("does not offer when notification permission is already granted", () => {
    expect(PushPrompt.shouldOffer(signals({ granted: true }))).toBe(false);
    expect(PushPrompt.shouldOffer(signals({ delight: "first-win", granted: true }))).toBe(false);
  });

  it("does not offer when the OS will not ask again", () => {
    expect(PushPrompt.shouldOffer(signals({ canAskAgain: false }))).toBe(false);
  });

  it("does not offer when permission cannot be read", () => {
    expect(PushPrompt.shouldOffer(signals({ permissionKnown: false, canAskAgain: true }))).toBe(false);
  });

  it("does not offer while push is switched off — accepting would not ask the OS", () => {
    expect(PushPrompt.shouldOffer(signals({ pushOn: false }))).toBe(false);
  });

  it("does not offer when the chest reminder itself is switched off", () => {
    expect(PushPrompt.shouldOffer(signals({ remindersOn: false }))).toBe(false);
  });

  it("stays quiet for the cooldown after a decline", () => {
    const declinedAt = NOW - 6 * DAY;
    expect(PushPrompt.shouldOffer(signals({ declinedAt }))).toBe(false);
    expect(PushPrompt.shouldOffer(signals({ delight: "first-win", declinedAt }))).toBe(false);
  });

  it("offers again once the cooldown has elapsed", () => {
    expect(PushPrompt.shouldOffer(signals({ declinedAt: NOW - PushPrompt.COOLDOWN_MS }))).toBe(true);
    expect(PushPrompt.shouldOffer(signals({ declinedAt: NOW - PushPrompt.COOLDOWN_MS + 1 }))).toBe(false);
  });
});

describe("PushPrompt.countWins", () => {
  it("counts personal wins and ignores pass-and-play, which has no local winner", () => {
    expect(PushPrompt.countWins({ ai: { won: 1 }, pass: { won: 0 }, online: { won: 2 } })).toBe(3);
  });
});
