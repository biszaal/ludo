/**
 * Remembers a "not now" on the soft notification ask.
 *
 * The OS permission itself is the OS's memory — granted, or can't-ask-again,
 * and we never show the sheet. What the OS does not remember is that the
 * player waved OUR sheet away, and a daily chest would otherwise ask again
 * tomorrow. One timestamp, persisted, is the whole cooldown.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { kvStorage } from "../lib/storage";

export interface PushPromptState {
  /** Epoch ms of the last decline, or null if they have never declined. */
  declinedAt: number | null;
  decline: (now: number) => void;
}

export const usePushPrompt = create<PushPromptState>()(
  persist(
    (set) => ({
      declinedAt: null,
      decline: (now) => set({ declinedAt: now }),
    }),
    {
      name: "ludo-push-prompt",
      version: 1,
      storage: createJSONStorage(kvStorage),
    },
  ),
);
