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
 * Unknown-means-free is deliberate: a failed catalog fetch should leave the
 * player able to use their cosmetics, not lock the ones they already own behind
 * a phantom price. The server rejects any purchase that shouldn't happen.
 */
export function priceOf(prices: Record<string, number>, sku: string): number {
  return prices[sku] ?? 0;
}

/** Owned, free, or not yet priced — anything the player may select. */
export function isUnlocked(owned: string[], prices: Record<string, number>, sku: string): boolean {
  return priceOf(prices, sku) === 0 || owned.includes(sku);
}

/** Which wallet a SKU charges. Unknown means coins (old server / no catalog). */
export function currencyOf(currencies: Record<string, "coins" | "gems">, sku: string): "coins" | "gems" {
  return currencies[sku] ?? "coins";
}
