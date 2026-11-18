/**
 * The first-game shortcut (growth plan, Nov 2026).
 *
 * About half of new players never finish a game, and the way into one was
 * Home → PLAY → a setup popup with three choices → PLAY again. A player who
 * has never finished an online game gets PLAY on Home as one tap: 1v1 Classic
 * at the lowest entry, the defaults the popup would have shown them anyway.
 * The entry is still on the button, so the tap is the player agreeing to it.
 *
 * "Never finished an online game" is read from the on-device stats. A player
 * who reinstalls keeps their account but loses those stats, so they get the
 * shortcut once more. That costs nothing they did not tap for.
 *
 * The stats load asynchronously, and until they have, everyone reads as new.
 * Callers pass null for "not loaded yet", and both answers then fall back to
 * how the app behaved before this existed.
 */

import { canAfford } from "./economy";

interface Totals {
  ai: { played: number };
  pass: { played: number };
  online: { played: number };
}

/** The entry to start with straight from Home, or null to open the setup popup.
 *  Null whenever the entry is not covered: the popup is where "not enough coins"
 *  and the watch-an-ad entry live. */
export function oneTapStake(onlinePlayed: number | null, balance: number | null, tiers: number[]): number | null {
  if (onlinePlayed === null || onlinePlayed > 0) return null;
  const lowest = tiers[0] ?? 100;
  return canAfford(balance, lowest) ? lowest : null;
}

/** Has this player finished a game of any kind on this device? */
export function playedAnyGame(totals: Totals | null): boolean {
  if (totals === null) return true;
  return totals.ai.played + totals.pass.played + totals.online.played > 0;
}
