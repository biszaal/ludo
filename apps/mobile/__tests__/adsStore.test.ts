/**
 * Interstitial gating matrix. Every clause is a hard veto, so each test flips
 * exactly one input away from a known-passing baseline.
 */

import { describe, it, expect, vi } from "vitest";

// configStore pulls in net/api -> lib/supabase -> react-native-url-polyfill,
// whose React Native source is Flow and can't be parsed under vitest. Every
// store test here stubs the api module for the same reason.
vi.mock("../src/net/api", () => ({ getConfig: vi.fn() }));

import { canShowInterstitial, adsEnabled, useAds } from "../src/store/adsStore";
import { DEFAULT_CONFIG, type AppConfig } from "../src/store/configStore";

const NOW = 1_000_000_000;
const MIN = 60_000;

/** A player well past the grace period, mid-session, with no recent ads. */
const ready = (over: Partial<Parameters<typeof canShowInterstitial>[0]> = {}) =>
  ({
    sessionCount: 10,
    matchesCompleted: 10,
    interstitialsThisSession: 0,
    lastInterstitialAt: 0,
    lastRewardedAt: 0,
    sessionStartedAt: NOW - 10 * MIN,
    lastStakedLossAt: 0,
    bumpSession: () => {},
    noteMatchFinished: () => {},
    noteInterstitialShown: () => {},
    noteRewardedShown: () => {},
    ...over,
  }) as Parameters<typeof canShowInterstitial>[0];

const cfg = (over: Partial<AppConfig["ads"]["interstitial"]> = {}): AppConfig => ({
  ...DEFAULT_CONFIG,
  ads: {
    ...DEFAULT_CONFIG.ads,
    interstitial: { ...DEFAULT_CONFIG.ads.interstitial, ...over },
  },
});

describe("interstitial gate", () => {
  it("allows a settled player at a clean break", () => {
    expect(canShowInterstitial(ready(), cfg(), false, NOW)).toBe(true);
  });

  it("never shows to a player who bought remove-ads", () => {
    expect(canShowInterstitial(ready(), cfg(), true, NOW)).toBe(false);
  });

  it("respects the global ads kill switch", () => {
    const off: AppConfig = { ...DEFAULT_CONFIG, ads: { ...DEFAULT_CONFIG.ads, enabled: false } };
    expect(canShowInterstitial(ready(), off, false, NOW)).toBe(false);
  });

  it("respects the interstitial-only kill switch", () => {
    expect(canShowInterstitial(ready(), cfg({ enabled: false }), false, NOW)).toBe(false);
  });

  it("holds off during the new-player session grace period", () => {
    expect(canShowInterstitial(ready({ sessionCount: 1 }), cfg({ minSessionsBeforeFirst: 2 }), false, NOW)).toBe(false);
  });

  it("holds off until enough matches have been finished", () => {
    expect(canShowInterstitial(ready({ matchesCompleted: 2 }), cfg({ minMatchesBeforeFirst: 3 }), false, NOW)).toBe(false);
  });

  it("stops at the per-session cap", () => {
    expect(canShowInterstitial(ready({ interstitialsThisSession: 3 }), cfg({ maxPerSession: 3 }), false, NOW)).toBe(false);
  });

  it("enforces the gap between interstitials", () => {
    const s = ready({ lastInterstitialAt: NOW - 60_000 });
    expect(canShowInterstitial(s, cfg({ minSecondsBetween: 180 }), false, NOW)).toBe(false);
    expect(canShowInterstitial(s, cfg({ minSecondsBetween: 30 }), false, NOW)).toBe(true);
  });

  it("leaves a freshly opened session alone", () => {
    expect(canShowInterstitial(ready({ sessionStartedAt: NOW - 5_000 }), cfg(), false, NOW)).toBe(false);
  });

  it("does not stack an interstitial onto a recent rewarded view", () => {
    expect(canShowInterstitial(ready({ lastRewardedAt: NOW - 10_000 }), cfg(), false, NOW)).toBe(false);
  });

  it("spares a player who just lost a staked match", () => {
    const s = ready({ lastStakedLossAt: NOW - 5_000 });
    expect(canShowInterstitial(s, cfg(), false, NOW)).toBe(false);
  });

  it("allows it once the staked-loss sting has passed", () => {
    expect(canShowInterstitial(ready({ lastStakedLossAt: NOW - 120_000 }), cfg(), false, NOW)).toBe(true);
  });

  it("can have staked-loss suppression turned off from config", () => {
    const s = ready({ lastStakedLossAt: NOW - 5_000 });
    expect(canShowInterstitial(s, cfg({ suppressAfterStakedLoss: false }), false, NOW)).toBe(true);
  });
});

describe("adsEnabled", () => {
  it("is off for entitled players and on otherwise", () => {
    expect(adsEnabled(DEFAULT_CONFIG, true)).toBe(false);
    expect(adsEnabled(DEFAULT_CONFIG, false)).toBe(true);
  });
});

describe("ads bookkeeping", () => {
  it("resets the per-session counter on a new session", () => {
    useAds.setState({ sessionCount: 4, interstitialsThisSession: 3 });
    useAds.getState().bumpSession();
    expect(useAds.getState().sessionCount).toBe(5);
    expect(useAds.getState().interstitialsThisSession).toBe(0);
  });

  it("records a staked loss but not a staked win", () => {
    useAds.setState({ lastStakedLossAt: 0, matchesCompleted: 0 });
    useAds.getState().noteMatchFinished(true, true);
    expect(useAds.getState().lastStakedLossAt).toBe(0);
    expect(useAds.getState().matchesCompleted).toBe(1);

    useAds.getState().noteMatchFinished(true, false);
    expect(useAds.getState().lastStakedLossAt).toBeGreaterThan(0);
    expect(useAds.getState().matchesCompleted).toBe(2);
  });

  it("does not record a loss in a friendly game", () => {
    useAds.setState({ lastStakedLossAt: 0 });
    useAds.getState().noteMatchFinished(false, false);
    expect(useAds.getState().lastStakedLossAt).toBe(0);
  });
});
