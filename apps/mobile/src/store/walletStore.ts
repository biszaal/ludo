/**
 * Coin balance mirror. The server owns the number (wallets table, mutated only
 * by the edge function); this store just caches the latest read for the UI and
 * quietly enforces the floor: any refresh that sees a balance under 100 asks
 * the server to top it back up, so a player can always afford the next game.
 */

import { create } from "zustand";
import * as api from "../net/api";

/** Mirrors WALLET_FLOOR in the edge function (the server has final say). */
export const WALLET_FLOOR = 100;
/** Mirrors QUICK_STAKE in the edge function — shown on the quick-match card. */
export const QUICK_STAKE = 100;

interface WalletStore {
  /** Latest known balance; null before the first successful read. */
  balance: number | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
}

export const useWallet = create<WalletStore>((set, get) => ({
  balance: null,
  refreshing: false,

  refresh: async () => {
    if (get().refreshing) return;
    set({ refreshing: true });
    try {
      let balance = await api.getWallet();
      if (balance < WALLET_FLOOR) balance = await api.topupWallet();
      set({ balance });
    } catch {
      // Offline or signed out — keep whatever we last knew; cosmetic only.
    } finally {
      set({ refreshing: false });
    }
  },
}));
