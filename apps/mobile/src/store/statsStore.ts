/**
 * Local match stats & history, persisted on device. Running totals survive the
 * capped history list. Recording happens in lib/feedback.ts when a game
 * finishes; pass-and-play has no "me", so didWin is null there.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Color } from "@ludo/engine";
import { kvStorage } from "../lib/storage";

export type MatchMode = "ai" | "pass" | "online";

export interface MatchRecord {
  id: string;
  mode: MatchMode;
  finishedAt: number;
  players: number;
  winnerLabel: string;
  winnerColor: Color;
  /** Did the local player win? null when there is no local "me" (pass & play). */
  didWin: boolean | null;
}

const HISTORY_CAP = 30;

interface StatsState {
  totals: Record<MatchMode, { played: number; won: number }>;
  recent: MatchRecord[];
  record: (r: MatchRecord) => void;
  reset: () => void;
}

const EMPTY_TOTALS: StatsState["totals"] = {
  ai: { played: 0, won: 0 },
  pass: { played: 0, won: 0 },
  online: { played: 0, won: 0 },
};

export const useStats = create<StatsState>()(
  persist(
    (set, get) => ({
      totals: EMPTY_TOTALS,
      recent: [],

      record: (r) => {
        const { totals, recent } = get();
        if (recent.some((m) => m.id === r.id)) return; // resync guard: one row per game
        const t = totals[r.mode];
        set({
          totals: { ...totals, [r.mode]: { played: t.played + 1, won: t.won + (r.didWin ? 1 : 0) } },
          recent: [r, ...recent].slice(0, HISTORY_CAP),
        });
      },

      reset: () => set({ totals: EMPTY_TOTALS, recent: [] }),
    }),
    {
      name: "ludo-stats",
      version: 1,
      storage: createJSONStorage(kvStorage),
    },
  ),
);
