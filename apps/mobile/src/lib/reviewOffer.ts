/**
 * Asks for a store rating after a win. The rules are {@link shouldAskForReview};
 * this file reads the stats and the last ask, and calls the OS.
 *
 * Only the native in-app dialog is used (`isAvailableAsync`). `hasAction` is
 * also true when the fallback would open the store page, and sending a player
 * out of the app mid-session is not worth a rating.
 */

import * as StoreReview from "expo-store-review";
import { useStats } from "../store/statsStore";
import { kvStorage } from "./storage";
import { shouldAskForReview } from "./review";

const ASKED_AT_KEY = "ludo-review-asked-at";

let asking = false;

export class ReviewOffer {
  /** The local player just won and the match is over. Never throws. */
  static async afterWin(): Promise<void> {
    if (asking) return;
    asking = true;
    try {
      const totals = useStats.getState().totals;
      const gamesPlayed = totals.ai.played + totals.pass.played + totals.online.played;
      const raw = await kvStorage().getItem(ASKED_AT_KEY);
      const lastAskedAt = raw ? Number(raw) : null;
      const now = Date.now();
      if (!shouldAskForReview({ won: true, gamesPlayed, lastAskedAt: Number.isFinite(lastAskedAt) ? lastAskedAt : null, now })) return;
      if (!(await StoreReview.isAvailableAsync())) return;
      // Recorded first: if the dialog crashes the app, it is not asked again tomorrow.
      await kvStorage().setItem(ASKED_AT_KEY, String(now));
      await StoreReview.requestReview();
    } catch {
      // The OS said no or the module is missing; nothing to do.
    } finally {
      asking = false;
    }
  }
}
