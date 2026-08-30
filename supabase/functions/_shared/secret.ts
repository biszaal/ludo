/**
 * Constant-time-ish compare, so a shared secret can't be probed a byte at a time.
 *
 * Shared rather than per-function because there are now three secret-authed
 * entrypoints across two functions — opTick and opSweepGuests in `game`, and
 * the RevenueCat webhook — and a second copy of this would be a second thing to
 * get subtly wrong. The webhook is the reason it moved here: it had been
 * comparing with `!==`, which short-circuits on the first differing byte, on
 * the one path that mints paid currency.
 *
 * Every caller must ALSO reject an empty `expected` before calling — this
 * returns true for "" vs "", which is the fail-open shape.
 */
export function secretMatches(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
