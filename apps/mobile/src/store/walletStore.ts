/**
 * Coin balance mirror. The server owns the number (wallets table, mutated only
 * by the edge function); this store caches the latest read for the UI.
 *
 * There is deliberately NO automatic top-up here any more. 0010 refilled any
 * balance under 100 for free on every home-screen mount, which meant coins
 * could never run out — and a currency you can't run out of is one nobody will
 * ever watch an ad or pay for. Coins now come from winning pots, the daily
 * bonus, rewarded ads, and a once-a-day pity grant at zero (`claimPity`), which
 * the UI offers explicitly rather than firing invisibly.
 */

import { create } from "zustand";
import * as api from "../net/api";
import { isPurchasesConfigured, purchaseGemProduct } from "../lib/purchases";

/** Baked fallback for the quick-match entry fee; the live number comes from
 *  remote config (`useConfig().config.economy.quickStake`). */
export const QUICK_STAKE = 100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** How long to wait for RevenueCat's webhook to credit gems after a purchase
 *  before giving up and showing whatever landed (8 × 1.5s ≈ 12s). */
const CREDIT_POLL_TRIES = 8;
const CREDIT_POLL_MS = 1500;

interface WalletStore {
  /** Latest known balance; null before the first successful read. */
  balance: number | null;
  /** Money-backed subset of `balance` (0 until coin packs ship). */
  purchasedBalance: number;
  /** Premium currency; null before the first successful read. */
  gems: number | null;
  /** Consecutive daily-bonus days, for the streak UI. */
  streakDay: number;
  bonusClaimable: boolean;
  /** Sitting at zero with a pity grant available. */
  pityAvailable: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
  /** Claim today's bonus. Returns the coins actually credited (0 if already
   *  taken — the server is idempotent by UTC date). */
  claimDailyBonus: () => Promise<number>;
  /** Last-resort grant when broke. Returns coins credited, 0 if not eligible. */
  claimPity: () => Promise<number>;
  /** Buy a gem pack (server-gated stub until real billing). Returns gems
   *  credited, 0 on failure. */
  buyGems: (productId: string) => Promise<number>;
  /** One-way gems→coins exchange. Returns coins credited, 0 on failure. */
  exchangeGems: (gems: number) => Promise<number>;
}

export const useWallet = create<WalletStore>((set, get) => ({
  balance: null,
  purchasedBalance: 0,
  gems: null,
  streakDay: 0,
  bonusClaimable: false,
  pityAvailable: false,
  refreshing: false,

  refresh: async () => {
    if (get().refreshing) return;
    set({ refreshing: true });
    try {
      const s = await api.getWalletState();
      set({
        balance: s.balance,
        purchasedBalance: s.purchasedBalance,
        gems: s.gems ?? 0,
        streakDay: s.streakDay,
        bonusClaimable: s.bonusClaimable,
        pityAvailable: s.pityAvailable,
      });
    } catch {
      // Offline or signed out — keep whatever we last knew; cosmetic only.
    } finally {
      set({ refreshing: false });
    }
  },

  claimDailyBonus: async () => {
    try {
      const res = await api.claimDailyBonus();
      set({ balance: res.balance, streakDay: res.streakDay, bonusClaimable: false });
      return res.claimed;
    } catch {
      return 0;
    }
  },

  claimPity: async () => {
    const before = get().balance ?? 0;
    try {
      const balance = await api.topupWallet();
      set({ balance, pityAvailable: false });
      return Math.max(0, balance - before);
    } catch {
      return 0;
    }
  },

  buyGems: async (productId) => {
    const before = get().gems ?? 0;

    // Real billing: RevenueCat takes the money and the rc-webhook credits gems
    // server-side, so we don't trust a client number — we poll the wallet for
    // the credit. (A user cancel or failure returns 0 with nothing charged.)
    if (isPurchasesConfigured()) {
      const outcome = await purchaseGemProduct(productId);
      if (outcome !== "success") return 0;
      for (let i = 0; i < CREDIT_POLL_TRIES; i++) {
        await sleep(CREDIT_POLL_MS);
        try {
          const s = await api.getWalletState();
          if ((s.gems ?? 0) > before) {
            set({ balance: s.balance, gems: s.gems ?? 0, purchasedBalance: s.purchasedBalance });
            return (s.gems ?? 0) - before;
          }
        } catch {
          // keep polling — a transient read failure isn't the purchase failing
        }
      }
      // Webhook is running late; surface whatever has landed and let a later
      // refresh catch up. The purchase itself is safe (server credits once).
      await get().refresh();
      return Math.max(0, (get().gems ?? 0) - before);
    }

    // Stub path (billing not wired for this build): the server grants directly,
    // gated behind gems.purchasesEnabled + allowStubProvider.
    try {
      const res = await api.gemsBuy(productId);
      set({ gems: res.gems });
      return Math.max(0, res.gems - before);
    } catch {
      return 0;
    }
  },

  exchangeGems: async (gems) => {
    const before = get().balance ?? 0;
    try {
      // Per-call idempotency key: a network retry of THIS exchange can't run
      // twice, while a deliberate second exchange gets its own key.
      const key = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const res = await api.gemsExchange(gems, key);
      set({ gems: res.gems, balance: res.balance });
      return Math.max(0, res.balance - before);
    } catch {
      return 0;
    }
  },
}));
