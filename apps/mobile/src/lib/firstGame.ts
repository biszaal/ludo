/**
 * A new player's way into their first game (growth plan, Nov 2026).
 *
 * About half of new players never finish a game. 1.3.2 answered that with a
 * one-tap PLAY: a player with no finished online game was dropped straight into
 * a 1v1 at the lowest entry. It got them seated, but it never showed that
 * 4-player tables exist, and it read "new" from the phone, so every reinstall
 * made a regular look brand new.
 *
 * It is replaced by a welcome intro (components/WelcomeIntro.tsx): two short
 * rule cards that end on the choice of game, 2 players, 4 players or vs the
 * computer, each one tap away, with Skip on screen from the first second. PLAY
 * on Home is the setup popup again, for everyone.
 *
 * Who sees the intro is decided here, pure, so it is pinned in Node. The live
 * wiring that reads the account is lib/useWelcomeIntro.ts.
 */

import { canAfford } from "./economy";

interface Totals {
  ai: { played: number };
  pass: { played: number };
  online: { played: number };
}

export interface IntroSignals {
  /** Has this phone shown (or retired) the intro already? (profileStore) */
  seen: boolean;
  /** Is the first-run name screen out of the way? The two must never stack. */
  nameDone: boolean;
  /** Games of any kind finished on this phone, or null while the stats load. */
  localPlayed: number | null;
  /** Online games this ACCOUNT has finished (server), or null while unknown. */
  onlinePlayed: number | null;
}

/**
 * "show" now; "wait" for a signal still in flight; "never" for a player the
 * intro is not for, which the caller records so it is not asked again (a later
 * sign-out mints a fresh guest on this phone, and a regular must not meet a
 * welcome screen then).
 *
 * Anything unknown waits rather than guesses: an intro over a regular's Home
 * is a worse mistake than a new player missing it and getting the popup.
 */
export function welcomeIntro(s: IntroSignals): "show" | "wait" | "never" {
  if (s.seen) return "never";
  if ((s.localPlayed ?? 0) > 0 || (s.onlinePlayed ?? 0) > 0) return "never";
  if (!s.nameDone || s.localPlayed === null || s.onlinePlayed === null) return "wait";
  return "show";
}

/** The entry the intro's online choices start at, or null to send the player to
 *  the setup popup instead, which is where "not enough coins" and the
 *  watch-an-ad entry live. */
export function introEntry(balance: number | null, tiers: number[]): number | null {
  const lowest = tiers[0] ?? 100;
  return canAfford(balance, lowest) ? lowest : null;
}

/** Has this player finished a game of any kind on this device? */
export function playedAnyGame(totals: Totals | null): boolean {
  if (totals === null) return true;
  return totals.ai.played + totals.pass.played + totals.online.played > 0;
}
