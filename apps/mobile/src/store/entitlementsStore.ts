/**
 * What the player owns, and what everything costs.
 *
 * This is the sink half of the coin economy: matches take coins, and cosmetics
 * are what coins are FOR. Without a sink, rewarded video has nothing to sell.
 *
 * Prices and ownership are both server-authoritative — the catalog table is the
 * only price list, and `shopBuy` re-reads it rather than trusting the client.
 * This store is a display cache, so a stale or edited copy changes what we SHOW
 * and never what a purchase actually costs.
 *
 * Everything sellable here is purely visual. A cosmetic that altered gameplay
 * would make coins buy an advantage, which the whole design forbids.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { kvStorage } from "../lib/storage";
import * as api from "../net/api";
import { useWallet } from "./walletStore";
import { purchaseNoAds, restorePurchases } from "../lib/purchases";

/** SKU naming mirrors the catalog seed in 0013_economy.sql / 0014_dice_skins.sql. */
export const themeSku = (id: string) => `theme.${id}`;
export const avatarSku = (id: string) => `avatar.${id}`;
export const diceSku = (id: string) => `dice.${id}`;
/**
 * Removes ads. A real-money non-consumable (0063), not a catalog purchase: the
 * `noads` catalog row stays inactive so it can never be bought with earned
 * coins or gems. Granted server-side by rc-webhook; read through
 * {@link noAdsActive}, which every ad gate in the app goes through.
 */
export const NO_ADS_SKU = "noads";

interface EntitlementsStore {
  /** SKUs the player owns. */
  owned: string[];
  /** sku -> price. Absent means the server has never heard of this sku — NOT
   *  that it is free. See isUnlocked. */
  prices: Record<string, number>;
  /** sku -> currency. Absent means coins (old server / cached view). */
  currencies: Record<string, "coins" | "gems">;
  loading: boolean;
  /** True when the last attempt finished and failed. Never persisted — a
   *  failure is about this moment's network, not about the cached catalog,
   *  which stays valid and stays sellable. */
  failed: boolean;
  /** Set while a purchase is in flight, so the UI can disable the tile. */
  buying: string | null;
  /**
   * RevenueCat's own answer to "does this player own Remove Ads".
   *
   * Persisted alongside `owned` so an offline launch does not put ads back in
   * front of someone who paid to remove them — the worst-feeling possible bug
   * for this particular purchase.
   */
  noAdsRestored: boolean;
  refresh: () => Promise<void>;
  /** Returns null on success, or a message to show the player. */
  buy: (sku: string) => Promise<string | null>;
  /** Buy Remove Ads for real money. Returns null on success, else a message. */
  buyNoAds: (productId: string) => Promise<string | null>;
  /** Re-attach previous purchases. Resolves true when Remove Ads came back. */
  restore: () => Promise<boolean>;
}

/**
 * How long to wait for the webhook's grant before giving up on seeing it.
 *
 * Same shape as walletStore's gem-credit poll and for the same reason: the
 * money is already captured and the server grant is on its way, but it arrives
 * out-of-band. Unlike gems, though, nothing here depends on the row landing —
 * `noAdsRestored` has already turned the ads off locally — so this poll is
 * only tidying up, and running out of tries is not a failure.
 */
const GRANT_POLL_TRIES = 5;
const GRANT_POLL_MS = 1500;

/** Local, matching walletStore's — this store must keep unit-testing in Node. */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const useEntitlements = create<EntitlementsStore>()(
  persist(
    (set, get) => ({
      owned: [],
      prices: {},
      currencies: {},
      loading: false,
      failed: false,
      buying: null,
      noAdsRestored: false,

      refresh: async () => {
        if (get().loading) return;
        set({ loading: true });
        try {
          const { skus, catalog } = await api.getEntitlements();
          const prices: Record<string, number> = {};
          const currencies: Record<string, "coins" | "gems"> = {};
          for (const item of catalog) {
            prices[item.sku] = item.price;
            if (item.currency === "gems") currencies[item.sku] = "gems";
          }
          set({ owned: skus, prices, currencies, failed: false });
        } catch {
          // Offline — keep the cached view; buying will fail loudly anyway.
          // The flag is only read when there is NO cached catalog to fall back
          // on, which is the one case a player can neither see nor act on.
          set({ failed: true });
        } finally {
          set({ loading: false });
        }
      },

      buy: async (sku) => {
        if (get().buying) return null;
        set({ buying: sku });
        try {
          const res = await api.shopBuy(sku);
          set((s) => ({ owned: s.owned.includes(sku) ? s.owned : [...s.owned, sku] }));
          // The debit already happened server-side; mirror the new balances.
          useWallet.setState(
            res.gems == null ? { balance: res.balance } : { balance: res.balance, gems: res.gems },
          );
          return null;
        } catch (e) {
          return e instanceof Error ? e.message : "Could not complete that purchase.";
        } finally {
          set({ buying: null });
        }
      },

      /**
       * Remove Ads, bought with money rather than currency.
       *
       * Deliberately NOT routed through `buy` above: that one calls shopBuy,
       * which debits coins or gems from the catalog price, and this product is
       * priced by the store in the player's own currency. Sharing the path
       * would mean a catalog row that could also be bought for coins, which is
       * the thing migration 0063 exists to prevent.
       *
       * The ads go off the moment the store says yes. The server grant follows
       * from the webhook and is polled for below, but the player is not made
       * to wait on it — they have paid, and an ad shown in the gap between the
       * charge and the webhook is the one thing this purchase promised would
       * not happen.
       */
      buyNoAds: async (productId) => {
        if (get().buying) return null;
        set({ buying: NO_ADS_SKU });
        try {
          const outcome = await purchaseNoAds(productId);
          if (outcome === "cancelled") return null; // backing out is not an error
          if (outcome === "unavailable") return "Purchases aren't available on this device.";
          if (outcome === "error") return "Could not complete that purchase.";

          // "owned" means they already had it — the same happy ending, reached
          // by a player who reinstalled and tapped Buy instead of Restore.
          set({ noAdsRestored: true });

          for (let i = 0; i < GRANT_POLL_TRIES; i++) {
            await sleep(GRANT_POLL_MS);
            await get().refresh();
            if (get().owned.includes(NO_ADS_SKU)) break;
          }
          return null;
        } catch {
          return "Could not complete that purchase.";
        } finally {
          set({ buying: null });
        }
      },

      restore: async () => {
        const restored = await restorePurchases();
        if (restored) {
          set({ noAdsRestored: true });
          // The restore re-attaches the purchase to this RevenueCat user, which
          // is this Supabase user, so the server grant can land too. Best
          // effort: the local flag already carries the promise.
          void get().refresh();
        }
        return restored;
      },
    }),
    {
      name: "ludo-entitlements",
      version: 1,
      storage: createJSONStorage(kvStorage),
      partialize: (s) =>
        ({
          owned: s.owned,
          prices: s.prices,
          currencies: s.currencies,
          noAdsRestored: s.noAdsRestored,
        }) as unknown as EntitlementsStore,
    },
  ),
);

/**
 * Price of a SKU, or 0 when the catalog hasn't loaded or doesn't list it.
 *
 * Unknown-means-free mirrors the server: profiles_enforce_dice_skin also lets
 * an unpriced sku through, so a client that knows a skin the server hasn't
 * seeded yet still works.
 */
export function priceOf(prices: Record<string, number>, sku: string): number {
  return prices[sku] ?? 0;
}

/**
 * Does the catalog we fetched actually list this sku?
 *
 * Callers need this because priceOf cannot answer it: an unlisted sku and a
 * free one both come back 0. Anything selling a cosmetic must check here
 * first, or it offers a Buy button for something the server will refuse.
 */
export function inCatalog(prices: Record<string, number>, sku: string): boolean {
  return Object.prototype.hasOwnProperty.call(prices, sku);
}

/** Has a catalog ever been fetched (or restored from disk)? */
export function catalogKnown(prices: Record<string, number>): boolean {
  return Object.keys(prices).length > 0;
}

/**
 * May the player select this? Owned, or free according to a catalog we
 * actually have.
 *
 * That last clause matters more than it looks. `prices` starts empty, and
 * treating empty as "everything is free" let the locker offer every dice skin
 * before the catalog landed. Equipping one felt fine locally — and then
 * profiles_enforce_dice_skin silently nulled it on write, so the owner saw
 * their skin and every opponent saw plain classic, with no error anywhere.
 * Unverifiable is not the same as free.
 *
 * Anything already owned stays unlocked regardless, so a failed fetch still
 * can't lock someone out of cosmetics they paid for.
 */
export function isUnlocked(owned: string[], prices: Record<string, number>, sku: string): boolean {
  if (owned.includes(sku)) return true;
  if (!catalogKnown(prices)) return false;
  // Absent from a catalog we DID fetch is the same verdict as no catalog at
  // all, and for the same reason. priceOf answers 0 for an unlisted sku, which
  // read as free and handed out every cosmetic the client knew about before its
  // catalog row was seeded — the whole gem dice tier, equippable for nothing,
  // until the migration landed. The client registry ships in an app build and
  // the catalog ships in a migration; they will drift, so this has to fail
  // closed rather than trust that they never do.
  return inCatalog(prices, sku) && prices[sku] === 0;
}

/** Which wallet a SKU charges. Unknown means coins (old server / no catalog). */
export function currencyOf(currencies: Record<string, "coins" | "gems">, sku: string): "coins" | "gems" {
  return currencies[sku] ?? "coins";
}

/**
 * Does this player have Remove Ads?
 *
 * TWO SOURCES, ORed, and the asymmetry is the point.
 *
 * `owned` is the durable, server-written grant (rc-webhook → entitlements) and
 * is what survives a reinstall onto the same account. `noAdsRestored` is
 * RevenueCat's own answer, which is the only thing that can speak for a player
 * who reinstalled onto a FRESH anonymous account: their receipt is real, but
 * there is no row under this user id yet and no receipt we could check
 * server-side to make one.
 *
 * Either alone leaves a paying customer looking at ads, which is the single
 * worst outcome this feature has — worse than an occasional freeloader, whose
 * gain is bounded at "sees no ads". Nothing here can move coins, gems or a
 * match outcome, so the 0018 fairness invariant is untouched either way.
 */
export function noAdsActive(owned: string[], noAdsRestored: boolean): boolean {
  return noAdsRestored || owned.includes(NO_ADS_SKU);
}

/** The subscribing form, for components. Re-renders when either half changes. */
export function useNoAds(): boolean {
  const owned = useEntitlements((s) => s.owned);
  const restored = useEntitlements((s) => s.noAdsRestored);
  return noAdsActive(owned, restored);
}
