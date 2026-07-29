/**
 * Ad pacing state and the rules that gate it. Deliberately holds NO reference
 * to the ad SDK — this is the same split as settingsStore vs lib/sound, and it
 * keeps the whole gating matrix testable in Node.
 *
 * Interstitials are the only format gated here. Rewarded ads are player-
 * initiated, so they're never frequency-capped; their only limit is the
 * server-side daily grant cap in adRewardIntent.
 *
 * Ludo pushes against the usual pacing assumptions: a 4-player online match
 * runs 8-15 minutes, so there is exactly one natural break per match and the
 * caps below are about NOT wasting it at a bad moment, rather than about
 * throttling volume.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { kvStorage } from "../lib/storage";
import type { AppConfig } from "./configStore";

interface AdsState {
  /** Launches so far, for the new-player grace period. */
  sessionCount: number;
  /** Matches finished across all sessions, likewise. */
  matchesCompleted: number;
  interstitialsThisSession: number;
  /** Epoch ms; 0 = never. */
  lastInterstitialAt: number;
  lastRewardedAt: number;
  sessionStartedAt: number;
  lastStakedLossAt: number;

  bumpSession: () => void;
  noteMatchFinished: (staked: boolean, won: boolean) => void;
  noteInterstitialShown: () => void;
  noteRewardedShown: () => void;
}

/** Don't interrupt someone who just opened the app. */
const MIN_SESSION_AGE_MS = 60_000;
/** An interstitial right after a rewarded view reads as a double-ad. */
const REWARDED_COOLDOWN_MS = 60_000;
/** How recently a staked loss still counts as "just lost". */
const STAKED_LOSS_WINDOW_MS = 30_000;

export const useAds = create<AdsState>()(
  persist(
    (set) => ({
      sessionCount: 0,
      matchesCompleted: 0,
      interstitialsThisSession: 0,
      lastInterstitialAt: 0,
      lastRewardedAt: 0,
      sessionStartedAt: Date.now(),
      lastStakedLossAt: 0,

      bumpSession: () =>
        set((s) => ({
          sessionCount: s.sessionCount + 1,
          interstitialsThisSession: 0,
          sessionStartedAt: Date.now(),
        })),

      noteMatchFinished: (staked, won) =>
        set((s) => ({
          matchesCompleted: s.matchesCompleted + 1,
          lastStakedLossAt: staked && !won ? Date.now() : s.lastStakedLossAt,
        })),

      noteInterstitialShown: () =>
        set((s) => ({
          interstitialsThisSession: s.interstitialsThisSession + 1,
          lastInterstitialAt: Date.now(),
        })),

      noteRewardedShown: () => set({ lastRewardedAt: Date.now() }),
    }),
    {
      name: "ludo-ads",
      version: 1,
      storage: createJSONStorage(kvStorage),
      // sessionStartedAt and the per-session counter must not survive a launch.
      partialize: (s) =>
        ({
          sessionCount: s.sessionCount,
          matchesCompleted: s.matchesCompleted,
          lastInterstitialAt: s.lastInterstitialAt,
          lastRewardedAt: s.lastRewardedAt,
          lastStakedLossAt: s.lastStakedLossAt,
        }) as unknown as AdsState,
    },
  ),
);

/** Are ads shown at all? `entitled` is the future "remove ads" purchase —
 *  wired from day one so the SKU only has to be switched on, never plumbed. */
export function adsEnabled(cfg: AppConfig, entitled: boolean): boolean {
  return cfg.ads.enabled && !entitled;
}

/**
 * The interstitial gate. Pure so the whole matrix is unit-testable; pass
 * `now` in tests.
 *
 * Order matters only for readability — every clause is a hard veto.
 */
export function canShowInterstitial(
  s: AdsState,
  cfg: AppConfig,
  entitled: boolean,
  now: number = Date.now(),
): boolean {
  if (!adsEnabled(cfg, entitled)) return false;

  const i = cfg.ads.interstitial;
  if (!i.enabled) return false;

  // New-player grace: neither counter has been bumped for THIS match yet at
  // call time, so these read as "sessions/matches completed before now".
  if (s.sessionCount < i.minSessionsBeforeFirst) return false;
  if (s.matchesCompleted < i.minMatchesBeforeFirst) return false;

  if (s.interstitialsThisSession >= i.maxPerSession) return false;
  if (now - s.lastInterstitialAt < i.minSecondsBetween * 1000) return false;

  if (now - s.sessionStartedAt < MIN_SESSION_AGE_MS) return false;
  if (now - s.lastRewardedAt < REWARDED_COOLDOWN_MS) return false;

  // Losing a staked match is the worst moment in the app to interrupt someone.
  // Config-flagged so it can be A/B'd later, but on by default.
  if (i.suppressAfterStakedLoss && now - s.lastStakedLossAt < STAKED_LOSS_WINDOW_MS) return false;

  return true;
}
