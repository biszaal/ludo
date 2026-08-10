/**
 * Remembers whether the daily-bonus calendar has already popped itself today.
 *
 * This store deliberately holds almost nothing. Whether a bonus is AVAILABLE is
 * the server's answer (`wallets.last_bonus_on !== utcDay()`, surfaced as
 * `useWallet.bonusClaimable`), so day-gating is already free and duplicating it
 * here would just create a second truth to drift. The only thing the client has
 * to remember is that it already showed the sheet — otherwise the calendar
 * reopens on every Home remount, and Home remounts on every popTo("home").
 *
 * Persisted because "once a day" has to survive a relaunch; the auto-open is a
 * courtesy, not the claim surface, and re-showing it after every cold start
 * would read as nagging.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { kvStorage } from "../lib/storage";

export interface DailyBonusState {
  /** UTC day (YYYY-MM-DD) the sheet last auto-opened on; null = never. */
  lastAutoShownDay: string | null;
  noteAutoShown: (day: string) => void;
}

export const useDailyBonus = create<DailyBonusState>()(
  persist(
    (set) => ({
      lastAutoShownDay: null,
      noteAutoShown: (day) => set({ lastAutoShownDay: day }),
    }),
    {
      name: "ludo-daily-bonus",
      version: 1,
      storage: createJSONStorage(kvStorage),
    },
  ),
);

/**
 * Should the calendar open on its own right now? Pure so the matrix is
 * unit-testable — pass the day rather than reading the clock.
 *
 * `bonusClaimable` comes from the server and is false the instant a claim
 * lands, so this cannot re-open behind a claim already made on another device.
 */
export function shouldAutoShow(
  s: Pick<DailyBonusState, "lastAutoShownDay">,
  bonusClaimable: boolean,
  today: string,
): boolean {
  if (!bonusClaimable) return false;
  return s.lastAutoShownDay !== today;
}
