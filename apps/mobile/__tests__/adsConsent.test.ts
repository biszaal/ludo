import { describe, it, expect, vi } from 'vitest';
import { resolveConsent } from '../src/lib/ads/consent';

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
