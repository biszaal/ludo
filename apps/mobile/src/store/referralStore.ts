/**
 * The invite card's data, and which reward pop-ups this device has already shown.
 *
 * Only `announced` is persisted: a pop-up must not repeat after a relaunch.
 * `data` is refetched (Friends forces it; Home is throttled to once every
 * 5 minutes, because Home remounts after every game). A failed fetch leaves
 * `data` null, which hides the card and every reward surface, so an app talking
 * to a server without the programme simply shows nothing.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { kvStorage } from "../lib/storage";
import { getReferrals } from "../net/api";
import type { ReferralsResponse } from "../lib/referrals";

const THROTTLE_MS = 5 * 60_000;

interface ReferralStoreState {
  data: ReferralsResponse | null;
  /** Epoch ms of the last attempt, successful or not. */
  loadedAt: number;
  announced: string[];
  load: (opts?: { force?: boolean }) => Promise<void>;
  markAnnounced: (keys: string[]) => void;
}

export const useReferrals = create<ReferralStoreState>()(
  persist(
    (set, get) => ({
      data: null,
      loadedAt: 0,
      announced: [],

      load: async (opts) => {
        if (!opts?.force && Date.now() - get().loadedAt < THROTTLE_MS) return;
        set({ loadedAt: Date.now() });
        try {
          set({ data: await getReferrals() });
        } catch {
          // Keep whatever we had; a first failure leaves the card hidden.
        }
      },

      markAnnounced: (keys) => {
        const announced = get().announced;
        const next = [...announced, ...keys.filter((k) => !announced.includes(k))];
        if (next.length !== announced.length) set({ announced: next });
      },
    }),
    {
      name: "ludo-referrals",
      version: 1,
      storage: createJSONStorage(kvStorage),
      partialize: (s) => ({ announced: s.announced }),
    },
  ),
);
