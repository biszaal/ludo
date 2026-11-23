/**
 * A new player's way into their first game.
 *
 * Most new players never finish a game (growth plan, Nov 2026). The one-tap
 * PLAY that tried to fix that started a 1v1 without ever showing that 4-player
 * tables exist, and it read "new" from the phone, so a reinstall made a regular
 * look new. A short welcome intro replaced it: it teaches two rules and ends on
 * the choice of game. These pin who sees it, and when.
 */

import { describe, it, expect } from "vitest";
import { introEntry, playedAnyGame, welcomeIntro } from "../src/lib/firstGame";

const TIERS = [100, 1000, 10000];
const totals = (ai: number, pass: number, online: number) => ({
  ai: { played: ai, won: 0 },
  pass: { played: pass, won: 0 },
  online: { played: online, won: 0 },
});
const brandNew = { seen: false, nameDone: true, localPlayed: 0, onlinePlayed: 0 };

describe("welcomeIntro", () => {
  it("shows to a brand-new player once the name screen is done", () => {
    expect(welcomeIntro(brandNew)).toBe("show");
  });

  it("never shows twice", () => {
    expect(welcomeIntro({ ...brandNew, seen: true })).toBe("never");
  });

  it("waits for the name screen, so the two never stack", () => {
    expect(welcomeIntro({ ...brandNew, nameDone: false })).toBe("wait");
  });

  it("waits while the on-device stats load, because until then everyone reads as new", () => {
    expect(welcomeIntro({ ...brandNew, localPlayed: null })).toBe("wait");
  });

  it("waits while the account's record is unknown rather than guess", () => {
    // Loading, or unreadable (offline): showing it to a regular is the worse mistake.
    expect(welcomeIntro({ ...brandNew, onlinePlayed: null })).toBe("wait");
  });

  it("is never for a player who has finished a game on this phone", () => {
    expect(welcomeIntro({ ...brandNew, localPlayed: 1 })).toBe("never");
  });

  it("is never for an account with online games, even on a fresh install", () => {
    // A reinstall empties the phone's stats; the account's record survives.
    expect(welcomeIntro({ ...brandNew, localPlayed: 0, onlinePlayed: 12 })).toBe("never");
  });

  it("retires a regular even before the name screen has closed", () => {
    expect(welcomeIntro({ ...brandNew, nameDone: false, onlinePlayed: 3 })).toBe("never");
  });
});

describe("introEntry", () => {
  it("is the lowest entry when the balance covers it", () => {
    expect(introEntry(500, TIERS)).toBe(100);
  });

  it("is null when the entry is not covered, so the popup offers its ad-for-entry path", () => {
    expect(introEntry(99, TIERS)).toBeNull();
  });

  it("is null while the wallet has not loaded rather than guess", () => {
    expect(introEntry(null, TIERS)).toBeNull();
  });

  it("uses the default 100 entry when config carries no tiers, as the popup does", () => {
    expect(introEntry(500, [])).toBe(100);
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
