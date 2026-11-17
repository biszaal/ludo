import { describe, it, expect, vi } from 'vitest';
import { consentRetryDelay, resolveConsent, shouldRetryConsent } from '../src/lib/ads/consent';

describe('ad consent failures', () => {
  const unavailable = async () => { throw new Error('offline'); };
  it('uses the SDK answer after a successful refresh', async () => {
    const cached = vi.fn();
    const result = await resolveConsent(async () => ({status:'OBTAINED',canRequestAds:false}), cached);
    expect(result.info?.canRequestAds).toBe(false);
    expect(cached).not.toHaveBeenCalled();
  });
  it('allows only an explicitly permitted cached SDK answer after failure', async () => {
    for (const allowed of [true,false]) {
      const result = await resolveConsent(unavailable, async () => ({status:'OBTAINED',canRequestAds:allowed}));
      expect(result.info?.canRequestAds).toBe(allowed);
      expect(result.error).toBeInstanceOf(Error);
    }
  });
  it('leaves permission unknown when both SDK calls fail', async () => {
    expect((await resolveConsent(unavailable, unavailable)).info).toBeNull();
  });
});

describe('retrying a consent check that could not be made', () => {
  it('retries only when the check failed, never when it answered no', () => {
    expect(shouldRetryConsent(false, new Error('offline'))).toBe(true);
    expect(shouldRetryConsent(false, null)).toBe(false);
    expect(shouldRetryConsent(true, null)).toBe(false);
    expect(shouldRetryConsent(true, new Error('offline'))).toBe(false);
  });
  it('backs off and then stops the timer', () => {
    const delays = [0, 1, 2, 3, 4].map((n) => consentRetryDelay(n));
    expect(delays.every((d) => typeof d === 'number' && d > 0)).toBe(true);
    for (let i = 1; i < delays.length; i++) expect(delays[i]!).toBeGreaterThan(delays[i - 1]!);
    expect(consentRetryDelay(5)).toBeNull();
  });
});
