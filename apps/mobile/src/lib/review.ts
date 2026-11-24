/**
 * When to ask for a store rating.
 *
 * Right after a win, from the third finished game on, and at most once every
 * 90 days. Apple and Google also cap how often their dialog appears, and may
 * show nothing at all; this gate only decides when we ask, so a loss or a
 * first game never gets one.
 *
 * Pure. The OS call and the stores live in reviewOffer.
 */

export const REVIEW_MIN_GAMES = 3;
export const REVIEW_GAP_MS = 90 * 24 * 60 * 60 * 1000;

export interface ReviewSignals {
  /** The local player won the game that just ended. */
  won: boolean;
  /** Finished games on the books, this one included. */
  gamesPlayed: number;
  lastAskedAt: number | null;
  now: number;
}

export function shouldAskForReview(s: ReviewSignals): boolean {
  if (!s.won || s.gamesPlayed < REVIEW_MIN_GAMES) return false;
  if (s.lastAskedAt !== null && s.now - s.lastAskedAt < REVIEW_GAP_MS) return false;
  return true;
}
