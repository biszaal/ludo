import { trackProductEvent } from "../lib/analytics";
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
import { rememberPurchase, pendingPurchases, forgetPurchase } from "../lib/purchaseJournal";
import type { GemReceipt } from "../lib/purchases";
import { isPurchasesConfigured, purchaseGemProduct } from "../lib/purchases";

/** Baked fallback for the quick-match entry fee; the live number comes from
 *  remote config (`useConfig().config.economy.quickStake`). */
export const QUICK_STAKE = 100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** How long to wait for RevenueCat's webhook to credit gems after a purchase
 *  before giving up and showing whatever landed (8 × 1.5s ≈ 12s). */
const CREDIT_POLL_TRIES = 8;
const CREDIT_POLL_MS = 1500;

/**
 * Bumped by every authoritative write (a claim, a purchase, an exchange). A
 * refresh captures it before its request goes out and drops its own result if
 * the number moved while it was in flight.
 *
 * Without this, a read that STARTED before a claim could land after it and
 * overwrite the new balance with the pre-claim one — HomeScreen refreshes on
 * mount and on every onlineStatus change, so the overlap was easy to hit. That
 * is the "sometimes the daily bonus didn't add my coins" case: the coins were
 * banked server-side and the screen was showing a stale read of them.
 */
let writeGen = 0;
let accountGeneration = 0;
/** The refresh currently in flight, shared by concurrent callers. */
let inFlight: Promise<void> | null = null;

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
  reset: () => void;
  reconcilePurchases: () => Promise<void>;
  /**
   * Claim today's bonus. Resolves with the coins actually credited — 0 means
   * the server says today is already banked (idempotent by UTC date).
   *
   * REJECTS on a network/server failure rather than resolving 0: the two used
   * to be indistinguishable, so an offline tap told the player their bonus was
   * gone for the day when it was still sitting there waiting.
   */
  claimDailyBonus: () => Promise<number>;
  /** Last-resort grant when broke. Returns coins credited, 0 if not eligible. */
  claimPity: () => Promise<number>;
  /** Buy a gem pack (server-gated stub until real billing). Returns gems
   *  credited; use gemPurchaseStatus to distinguish zero-credit outcomes. */
  buyGems: (productId: string) => Promise<number>;
  gemPurchaseStatus: "idle" | "purchasing" | "pending" | "delivered" | "cancelled" | "unavailable" | "error";
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
  gemPurchaseStatus: "idle",

  reset: () => {
    accountGeneration++;
    writeGen++;
    inFlight = null;
    set({ balance: null, gems: null, purchasedBalance: 0, streakDay: 0,
      bonusClaimable: false, pityAvailable: false, refreshing: false, gemPurchaseStatus: "idle" });
  },

  reconcilePurchases: async () => {
    if (!isPurchasesConfigured()) return;
    const generation = accountGeneration;
    try {
      const userId = await api.ensureSignedIn();
      const pending = await pendingPurchases(userId);
      let unresolved = false;
      let delivered = false;
      for (const receipt of pending) {
        const gems = await api.getGemPurchaseDelivery(receipt);
        if (generation !== accountGeneration) return;
        if (gems === null) unresolved = true;
        else { await forgetPurchase(receipt); delivered = true; }
      }
      if (generation === accountGeneration && get().gemPurchaseStatus !== "purchasing") {
        if (unresolved) set({ gemPurchaseStatus: "pending" });
        else if (delivered) set({ gemPurchaseStatus: "delivered" });
      }
    } catch { /* Keep pending receipts for the next foreground/store refresh. */ }
  },

  // Callers await the SAME request rather than the early caller returning
  // instantly with nothing fetched — `await refresh()` has to mean "the balance
  // on screen is current", which is exactly what DailyBonusSheet relies on.
  refresh: async () => {
    if (inFlight) return inFlight;
    const startedAt = writeGen;
    const generation = accountGeneration;
    set({ refreshing: true });
    inFlight = (async () => {
      try {
        const s = await api.getWalletState();
        // A claim landed while this read was in flight; its numbers are newer.
        if (writeGen !== startedAt) return;
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
        if (generation === accountGeneration) {
          inFlight = null;
          set({ refreshing: false });
        }
      }
    })();
    await inFlight;
    if (generation === accountGeneration) await get().reconcilePurchases();
  },

  claimDailyBonus: async () => {
    const generation = accountGeneration;
    const res = await api.claimDailyBonus();
    if (generation !== accountGeneration) return 0;
    writeGen++;
    set({
      balance: res.balance,
      // Only adopt a gem total the server actually sent — an old server
      // omits it, and coercing that to 0 would blank a real balance.
      ...(typeof res.gems === "number" ? { gems: res.gems } : null),
      streakDay: res.streakDay,
      bonusClaimable: false,
    });
    return res.claimed;
  },

  claimPity: async () => {
    const generation = accountGeneration;
    const before = get().balance ?? 0;
    try {
      const balance = await api.topupWallet();
      if (generation !== accountGeneration) return 0;
      writeGen++;
      set({ balance, pityAvailable: false });
      return Math.max(0, balance - before);
    } catch {
      return 0;
    }
  },

  buyGems: async (productId) => {
    if (get().gemPurchaseStatus === "purchasing") return 0;
    const generation = accountGeneration;
    set({ gemPurchaseStatus: "purchasing" });
    const before = get().gems ?? 0;

    // Real billing: RevenueCat takes the money and the rc-webhook credits gems
    // server-side, so we poll for the verified transaction receipt. (A user cancel or failure returns 0 with nothing charged.)
    if (isPurchasesConfigured()) {
      let receipt: GemReceipt | null = null;
      const outcome = await purchaseGemProduct(productId, async (r) => {
        receipt = r;
        await rememberPurchase(r);
      });
      if (generation !== accountGeneration) return 0;
      if (outcome !== "success") {
        set({ gemPurchaseStatus: outcome });
        return 0;
      }
      set({ gemPurchaseStatus: "pending" });
      if (!receipt) return 0; // No usable transaction id: never guess from balance.
      for (let i = 0; i < CREDIT_POLL_TRIES; i++) {
        await sleep(CREDIT_POLL_MS);
        if (generation !== accountGeneration) return 0;
        try {
          const credited = await api.getGemPurchaseDelivery(receipt);
          if (generation !== accountGeneration) return 0;
          if (credited !== null) {
            await forgetPurchase(receipt);
            if (generation !== accountGeneration) return 0;
            set({ gemPurchaseStatus: "delivered" });
            trackProductEvent("purchase_delivered");
            await get().refresh();
            return credited;
          }
        } catch { /* A failed receipt read remains pending, not failed checkout. */ }
      }
      await get().refresh();
      return 0;
    }

    // Stub path (billing not wired for this build): the server grants directly,
    // gated behind gems.purchasesEnabled + allowStubProvider.
    try {
      const res = await api.gemsBuy(productId);
      if (generation !== accountGeneration) return 0;
      writeGen++;
      set({ gems: res.gems, gemPurchaseStatus: "delivered" });
      return Math.max(0, res.gems - before);
    } catch {
      if (generation === accountGeneration) set({ gemPurchaseStatus: "error" });
      return 0;
    }
  },

  exchangeGems: async (gems) => {
    const generation = accountGeneration;
    const before = get().balance ?? 0;
    try {
      // Per-call idempotency key: a network retry of THIS exchange can't run
      // twice, while a deliberate second exchange gets its own key.
      const key = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const res = await api.gemsExchange(gems, key);
      if (generation !== accountGeneration) return 0;
      writeGen++;
      set({ gems: res.gems, balance: res.balance });
      return Math.max(0, res.balance - before);
    } catch {
      return 0;
    }
  },
}));
