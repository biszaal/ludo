/**
 * A new player's first online game is one tap.
 *
 * Most new players never finish a game (growth plan, Nov 2026), and the path
 * to one was Home → PLAY → a setup popup with three decisions → PLAY. These
 * pin who gets the shortcut: only a player who has never finished an online
 * game, and only when the entry is already covered, so the shortcut never
 * hides the popup's "not enough coins / watch an ad" path.
 */

import { describe, it, expect } from "vitest";
import { oneTapStake, playedAnyGame } from "../src/lib/firstGame";

const TIERS = [100, 1000, 10000];
const totals = (ai: number, pass: number, online: number) => ({
  ai: { played: ai, won: 0 },
  pass: { played: pass, won: 0 },
  online: { played: online, won: 0 },
});

describe("oneTapStake", () => {
  it("starts a first online game at the lowest entry", () => {
    expect(oneTapStake(0, 500, TIERS)).toBe(100);
  });

  it("opens the setup popup once they have finished an online game", () => {
    expect(oneTapStake(1, 500, TIERS)).toBeNull();
  });

  it("opens the popup when the entry is not covered, so the ad-for-entry path is offered", () => {
    expect(oneTapStake(0, 99, TIERS)).toBeNull();
  });

  it("opens the popup while the wallet has not loaded rather than guess", () => {
    expect(oneTapStake(0, null, TIERS)).toBeNull();
  });

  it("uses the default 100 entry when config carries no tiers, as the popup does", () => {
    expect(oneTapStake(0, 500, [])).toBe(100);
  });

  it("opens the popup while the on-device stats are still loading", () => {
    // Stats load asynchronously, and until they do every player reads as new.
    // A regular who taps PLAY in that moment must still get the popup.
    expect(oneTapStake(null, 500, TIERS)).toBeNull();
  });
});

describe("playedAnyGame", () => {
  it("is false for a brand-new player", () => {
    expect(playedAnyGame(totals(0, 0, 0))).toBe(false);
  });

  it("treats stats that have not loaded yet as played, so nothing changes for regulars", () => {
    expect(playedAnyGame(null)).toBe(true);
  });

  it("counts a finished game in any mode", () => {
    expect(playedAnyGame(totals(1, 0, 0))).toBe(true);
    expect(playedAnyGame(totals(0, 1, 0))).toBe(true);
    expect(playedAnyGame(totals(0, 0, 1))).toBe(true);
  });
});
