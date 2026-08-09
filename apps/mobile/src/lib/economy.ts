/**
 * Coin maths shared by every surface that quotes a number at the player. The
 * server is the authority (settleIfFinished in the edge function); these
 * mirror it so the pre-match sheet, the in-game pot pill and the results
 * screen can't drift apart — they did, and 4-player pots read half their
 * real value everywhere but the quick-match sheet.
 */

/**
 * What the winner collects: every seat's entry, bot seats included (the house
 * funds those). Mirrors `stake * next.players.length` in the edge function —
 * pass the engine's player array length, not the lobby's, since that's what
 * the server settles against once seats are filled or vacated.
 */
export function potFor(stake: number, seatCount: number): number {
  if (stake <= 0 || seatCount <= 0) return 0;
  return stake * seatCount;
}

/**
 * How the pot divides by finishing place, longest-first (index 0 = winner).
 *
 * DISPLAY ONLY. The money is moved by payoutSplit in
 * supabase/functions/game/finish.ts; this mirrors it so the setup sheet and the
 * results screen can show what each place is worth. Keep the weights in step —
 * __tests__/economy.test.ts pins the exact figures for every stake tier.
 *
 *   2 seats  winner takes all
 *   3 seats  200 / 100 of a 300 pot
 *   4 seats  250 / 100 / 50 of a 400 pot
 */
const PLACE_WEIGHTS: Record<number, number[]> = {
  2: [1],
  3: [2, 1],
  4: [5, 2, 1],
};

export function payoutSplit(stake: number, seatCount: number): number[] {
  if (stake <= 0 || seatCount <= 0) return [];
  const pot = potFor(stake, seatCount);
  const weights = PLACE_WEIGHTS[seatCount] ?? [1];
  const total = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map((w) => Math.floor((pot * w) / total));
  shares[0] = (shares[0] ?? 0) + (pot - shares.reduce((a, b) => a + b, 0));
  return shares;
}

/** Whether a known balance covers an entry fee. An unread balance can't. */
export function canAfford(balance: number | null, stake: number): boolean {
  if (stake <= 0) return true;
  return balance !== null && balance >= stake;
}

/**
 * What the next daily-bonus claim is worth: base + step per banked streak day,
 * capped at the streak ceiling. Mirrors the server's grant so every surface
 * that quotes it (GetCoinsSheet, the Home chest tile) shows the same number.
 */
export function nextDailyBonus(
  streakDay: number,
  economy: { dailyBonusBase: number; streakStep: number; streakMaxDay: number },
): number {
  return economy.dailyBonusBase + economy.streakStep * Math.min(streakDay, economy.streakMaxDay - 1);
}
