/**
 * Remote config mirror. Ad pacing, economy amounts and shop flags come from the
 * server so they can be tuned per-region without a store release — eCPM varies
 * roughly 10x between markets and ours is unknown until launch.
 *
 * Never blocks: the baked defaults below are always a complete document, the
 * persisted copy is served instantly on launch, and a failed refresh keeps
 * whatever we last knew. Everything here is pacing and presentation — coin
 * amounts are re-decided server-side on every grant, so a stale or tampered
 * config can change what we SHOW but never what a player actually receives.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { kvStorage } from "../lib/storage";
import * as api from "../net/api";

export interface InterstitialConfig {
  enabled: boolean;
  /** Floor between two interstitials, in seconds. */
  minSecondsBetween: number;
  /** Sessions a new player gets before the first one. */
  minSessionsBeforeFirst: number;
  /** Matches a new player finishes before the first one. */
  minMatchesBeforeFirst: number;
  maxPerSession: number;
  /** Skip the ad when the player just lost a staked match — worst moment. */
  suppressAfterStakedLoss: boolean;
}

export interface RewardedConfig {
  /** Watch an ad to cover a quick-match entry you can't afford. */
  freeEntry: boolean;
  /** Watch an ad for coins from the Get Coins sheet / pause menu. */
  coinGrant: boolean;
  /** Winner-only: watch to top up the pot (house-funded, post-match). */
  doublePot: boolean;
  /** Move hints in local / vs-AI only. Hints are hard-gated off in online PvP
   *  regardless of this flag — a bought advantage over a human is never ok. */
  hintLocalOnly: boolean;
  /** Watch an ad for a small gem drip, hard-capped per day server-side.
   *  Gems buy APPEARANCE only, so this stays on the right side of the
   *  fairness invariant even though it touches the paid tier. */
  gemGrant: boolean;
}

export interface AppConfig {
  ads: {
    enabled: boolean;
    banner: { home: boolean; lobby: boolean };
    interstitial: InterstitialConfig;
    rewarded: RewardedConfig;
  };
  economy: {
    quickStake: number;
    startingBalance: number;
    dailyBonusBase: number;
    streakStep: number;
    streakMaxDay: number;
    /** Streak day that also pays gems (the finale). */
    gemDay: number;
    /** Gems paid on that day. */
    gemAmount: number;
    /** Quick-match entry tiers, low to high. */
    stakeTiers: number[];
  };
  shop: { enabled: boolean; coinPacksEnabled: boolean };
  gems: {
    enabled: boolean;
    /** Real-money purchases live (0027). The stub provider stays locked off
     *  server-side regardless — this flag only opens the real store path. */
    purchasesEnabled: boolean;
    /** Coins per gem in the one-way exchange. */
    exchangeRate: number;
    /** Smallest exchangeable amount. */
    exchangeMin: number;
    /** The rewarded-ad drip. Display only — the server owns both numbers. */
    adGrant: { amount: number; dailyCap: number };
    products: { id: string; gems: number; priceUsd: number }[];
  };
}

/** Offline fallback. Mirrors the seed row in 0012_app_config.sql; deliberately
 *  conservative, since this is what ships if the config call never succeeds. */
export const DEFAULT_CONFIG: AppConfig = {
  ads: {
    enabled: true,
    banner: { home: true, lobby: true },
    interstitial: {
      enabled: true,
      minSecondsBetween: 180,
      minSessionsBeforeFirst: 2,
      minMatchesBeforeFirst: 3,
      maxPerSession: 3,
      suppressAfterStakedLoss: true,
    },
    rewarded: { freeEntry: true, coinGrant: true, doublePot: true, hintLocalOnly: true, gemGrant: true },
  },
  economy: {
    quickStake: 100,
    startingBalance: 500,
    dailyBonusBase: 50,
    streakStep: 25,
    streakMaxDay: 7,
    gemDay: 7,
    gemAmount: 5,
    stakeTiers: [100, 1000, 10000],
  },
  shop: { enabled: true, coinPacksEnabled: false },
  gems: {
    enabled: true,
    purchasesEnabled: true,
    exchangeRate: 10,
    exchangeMin: 10,
    adGrant: { amount: 1, dailyCap: 1 },
    products: [
      { id: "gems.small", gems: 60, priceUsd: 0.99 },
      { id: "gems.medium", gems: 340, priceUsd: 4.99 },
      { id: "gems.large", gems: 750, priceUsd: 9.99 },
    ],
  },
};

type Json = Record<string, unknown>;

/** Deep-merge a partial server document over the baked defaults, so a config
 *  row that only sets one nested flag can't blank out its siblings. */
export function mergeConfig(base: AppConfig, over: unknown): AppConfig {
  if (!over || typeof over !== "object" || Array.isArray(over)) return base;
  const walk = (b: Json, o: Json): Json => {
    const out: Json = { ...b };
    for (const [k, v] of Object.entries(o)) {
      // Ignore keys we don't know and type mismatches — a malformed row must
      // never be able to knock a value out of shape at a call site.
      if (!(k in out)) continue;
      const prev = out[k];
      const bothPlain =
        prev !== null && typeof prev === "object" && !Array.isArray(prev) &&
        v !== null && typeof v === "object" && !Array.isArray(v);
      if (bothPlain) out[k] = walk(prev as Json, v as Json);
      else if (v !== null && typeof v === typeof prev) out[k] = v;
    }
    return out;
  };
  return walk(base as unknown as Json, over as Json) as unknown as AppConfig;
}

interface ConfigStore {
  config: AppConfig;
  /** Region the server resolved us to, for debugging. */
  region: string | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
}

export const useConfig = create<ConfigStore>()(
  persist(
    (set, get) => ({
      config: DEFAULT_CONFIG,
      region: null,
      refreshing: false,

      refresh: async () => {
        if (get().refreshing) return;
        set({ refreshing: true });
        try {
          const { config, region } = await api.getConfig();
          set({ config: mergeConfig(DEFAULT_CONFIG, config), region });
        } catch {
          // Offline or signed out — the persisted (or default) doc still stands.
        } finally {
          set({ refreshing: false });
        }
      },
    }),
    {
      name: "ludo-config",
      version: 1,
      storage: createJSONStorage(kvStorage),
      // Re-merge on rehydrate: a cached doc written by an older build can be
      // missing keys this build reads.
      merge: (persisted, current) => {
        const p = persisted as Partial<ConfigStore> | undefined;
        return { ...current, ...p, config: mergeConfig(DEFAULT_CONFIG, p?.config) };
      },
      partialize: (s) => ({ config: s.config, region: s.region }) as unknown as ConfigStore,
    },
  ),
);
