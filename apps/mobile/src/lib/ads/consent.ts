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
