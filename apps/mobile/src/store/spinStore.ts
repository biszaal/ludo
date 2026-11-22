/**
 * The reward spin's state on this device (server: migration 0086).
 *
 * Not persisted: what is owed is the server's answer, read on Home and after
 * every spin. The one thing this store owns is the request id. A claim keeps
 * its id until the server answers, so a retry after a timeout (or a dropped
 * connection after the server already paid) sends the SAME id, and the server
 * hands back the first result instead of paying again. One claim at a time: a
 * second tap while one is out returns null and sends nothing.
 */

import { create } from "zustand";
import * as api from "../net/api";
import type { SpinClaim } from "../net/api";
import { randomId } from "../lib/deviceId";
import type { SpinSource, SpinState } from "../lib/spin";
import { useWallet } from "./walletStore";

interface SpinStore {
  /** null until read, and after a read fails (the tile hides). */
  state: SpinState | null;
  claiming: boolean;
  /** The id each source's unanswered claim will be retried with. */
  pending: Partial<Record<SpinSource, string>>;
  refresh: () => Promise<void>;
  /** Throws on a network or server error, keeping the id for the retry. */
  claim: (source: SpinSource) => Promise<SpinClaim | null>;
}

export const useSpin = create<SpinStore>((set, get) => ({
  state: null,
  claiming: false,
  pending: {},

  refresh: async () => {
    try {
      set({ state: await api.getSpinState() });
    } catch {
      set({ state: null });
    }
  },

  claim: async (source) => {
    if (get().claiming) return null;
    const requestId = get().pending[source] ?? randomId();
    set({ claiming: true, pending: { ...get().pending, [source]: requestId } });
    try {
      const result = await api.claimSpin(source, requestId);
      // Answered: this id is spent either way.
      const { [source]: _spent, ...rest } = get().pending;
      set({ pending: rest });
      if (result.ok) {
        set({ state: result.status });
        useWallet.setState({ balance: result.balance, gems: result.gems });
      } else if (result.reason === "disabled") {
        set({ state: { enabled: false } });
      } else if (result.reason === "not_owed") {
        // The day rolled over or another device took it: show what is owed now.
        await get().refresh();
      }
      return result;
    } finally {
      set({ claiming: false });
    }
  },
}));
