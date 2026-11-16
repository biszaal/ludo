/** UMP remains the authority after a failed refresh; unknown never permits ads. */
export async function resolveConsent<T extends { status: unknown; canRequestAds: boolean }>(
  gather: () => Promise<T>,
  cached: () => Promise<T>,
): Promise<{ info: T | null; error: unknown }> {
  try {
    return { info: await gather(), error: null };
  } catch (error) {
    try { return { info: await cached(), error }; }
    catch { return { info: null, error }; }
  }
}

/**
 * How long to wait before asking UMP again after an attempt that could not
 * reach it, or null to stop the timer (a return to the foreground still asks).
 *
 * 1.3.0 stopped falling back to "request ads anyway" when the consent answer is
 * unknown, which is right — but start-up asked exactly once, so a slow or
 * offline launch left the whole session without ads. The answer is to keep
 * asking, not to guess.
 */
const CONSENT_RETRY_MS = [10_000, 30_000, 60_000, 120_000, 300_000];

export function consentRetryDelay(attempt: number): number | null {
  return CONSENT_RETRY_MS[attempt] ?? null;
}

/**
 * Retry only when consent is unknown BECAUSE the check failed. A check that
 * succeeded and said no is the player's answer, and is not asked again behind
 * their back.
 */
export function shouldRetryConsent(permitted: boolean, error: unknown): boolean {
  return !permitted && error != null;
}

