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

/** SKU naming mirrors the catalog seed in 0013_economy.sql / 0014_dice_skins.sql. */
export const themeSku = (id: string) => `theme.${id}`;
export const avatarSku = (id: string) => `avatar.${id}`;
export const diceSku = (id: string) => `dice.${id}`;
/** Removes ads. Sold later (Phase 8 IAP); honoured by the ad gates already. */
export const NO_ADS_SKU = "noads";

interface EntitlementsStore {
  /** SKUs the player owns. */
  owned: string[];
  /** sku -> price. Absent means "not in the catalog" (treat as free). */
  prices: Record<string, number>;
  /** sku -> currency. Absent means coins (old server / cached view). */
  currencies: Record<string, "coins" | "gems">;
  loading: boolean;
  /** Set while a purchase is in flight, so the UI can disable the tile. */
  buying: string | null;
  refresh: () => Promise<void>;
  /** Returns null on success, or a message to show the player. */
  buy: (sku: string) => Promise<string | null>;
}

export const useEntitlements = create<EntitlementsStore>()(
  persist(
    (set, get) => ({
      owned: [],
      prices: {},
      currencies: {},
      loading: false,
      buying: null,

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
          set({ owned: skus, prices, currencies });
        } catch {
          // Offline — keep the cached view; buying will fail loudly anyway.
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
    }),
    {
      name: "ludo-entitlements",
      version: 1,
      storage: createJSONStorage(kvStorage),
      partialize: (s) =>
        ({ owned: s.owned, prices: s.prices, currencies: s.currencies }) as unknown as EntitlementsStore,
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
  return priceOf(prices, sku) === 0;
}

/** Which wallet a SKU charges. Unknown means coins (old server / no catalog). */
export function currencyOf(currencies: Record<string, "coins" | "gems">, sku: string): "coins" | "gems" {
  return currencies[sku] ?? "coins";
}
