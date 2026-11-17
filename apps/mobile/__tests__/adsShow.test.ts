/**
 * A full-screen ad whose show() is refused must never hang the flow waiting on it.
 *
 * react-native-google-mobile-ads' show() returns a promise. On iOS it rejects when
 * no view controller can present ("nil-vc") or the ad expired ("not-ready"), and
 * no ERROR event follows. provider.ts called it without handling that rejection,
 * so showInterstitial never settled — GameView awaits it before leaving a finished
 * match — and the rejection never reached the Settings diagnostics.
 */
import { beforeEach, afterEach, it, expect, vi } from 'vitest';

type Listener = (payload?: unknown) => void;
const mocks = vi.hoisted(() => ({ gather: vi.fn(), initialize: vi.fn(), createInterstitial: vi.fn(), createRewarded: vi.fn() }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-tracking-transparency', () => ({
  getTrackingPermissionsAsync: vi.fn().mockResolvedValue({ status: 'denied' }),
  requestTrackingPermissionsAsync: vi.fn(),
}));
vi.mock('../src/lib/ads/units', () => ({ TEST_DEVICE_IDS: [], interstitialUnitId: () => 'test', rewardedUnitId: () => 'test' }));
vi.mock('../src/lib/analytics', () => ({ trackProductEvent: vi.fn() }));
vi.mock('../src/lib/ads/native', () => ({
  adsSdk: {
    AdsConsent: { gatherConsent: mocks.gather, getConsentInfo: vi.fn() },
    default: () => ({ initialize: mocks.initialize }),
    InterstitialAd: { createForAdRequest: mocks.createInterstitial },
    RewardedAd: { createForAdRequest: mocks.createRewarded },
    AdEventType: { LOADED: 'loaded', ERROR: 'error', CLOSED: 'closed' },
    RewardedAdEventType: { LOADED: 'r-loaded', EARNED_REWARD: 'earned' },
  },
}));

/** A fake full-screen ad whose show() is refused the way iOS refuses it. */
function fakeAd(showResult: () => Promise<void>) {
  const listeners = new Map<string, Listener[]>();
  return {
    listeners,
    emit(type: string, payload?: unknown) {
      for (const l of listeners.get(type) ?? []) l(payload);
    },
    addAdEventListener(type: string, l: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), l]);
      return () => listeners.set(type, (listeners.get(type) ?? []).filter((x) => x !== l));
    },
    load: vi.fn(),
    show: vi.fn(showResult),
  };
}
const refused = () => Promise.reject({ code: 'nil-vc', message: 'Ad attempted to show but the current View Controller was nil.' });

let provider: typeof import('../src/lib/ads/provider');
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.gather.mockResolvedValue({ status: 'OBTAINED', canRequestAds: true, privacyOptionsRequirementStatus: 'NOT_REQUIRED' });
  provider = await import('../src/lib/ads/provider');
});
afterEach(() => {
  vi.useRealTimers();
});

it('an interstitial whose show() is refused settles false and is recorded', async () => {
  const ad = fakeAd(refused);
  mocks.createInterstitial.mockReturnValue(ad);
  await provider.initAds();
  ad.emit('loaded');

  const shown = await Promise.race([
    provider.showInterstitial(),
    new Promise((r) => setTimeout(() => r('hung'), 500)),
  ]);
  expect(shown).toBe(false);
  expect(provider.adsDiagnostics().lastErrors.interstitial?.text).toContain('nil-vc');
});

it('a rewarded ad whose show() is refused settles "failed" and is recorded', async () => {
  const ad = fakeAd(refused);
  mocks.createRewarded.mockReturnValue(ad);
  mocks.createInterstitial.mockReturnValue(fakeAd(() => Promise.resolve()));
  await provider.initAds();

  const outcome = provider.showRewarded('nonce', 'user');
  ad.emit('r-loaded');
  const result = await Promise.race([outcome, new Promise((r) => setTimeout(() => r('hung'), 500))]);
  expect(result).toBe('failed');
  expect(provider.adsDiagnostics().lastErrors.rewarded?.text).toContain('nil-vc');
});

it('a rewarded ad that never loads gives up instead of waiting forever', async () => {
  const ad = fakeAd(() => Promise.resolve());
  mocks.createRewarded.mockReturnValue(ad);
  mocks.createInterstitial.mockReturnValue(fakeAd(() => Promise.resolve()));
  await provider.initAds();

  vi.useFakeTimers();
  const outcome = provider.showRewarded('nonce', 'user');
  await vi.advanceTimersByTimeAsync(provider.REWARDED_LOAD_TIMEOUT_MS + 1);
  expect(await outcome).toBe('failed');
  expect(provider.adsDiagnostics().lastErrors.rewarded?.text).toMatch(/timed out/i);

  // A late LOADED after giving up must not pop an ad over whatever the player is doing now.
  ad.emit('r-loaded');
  expect(ad.show).not.toHaveBeenCalled();
});

it('a rewarded ad that loads in time still shows and reports the reward', async () => {
  const ad = fakeAd(() => Promise.resolve());
  mocks.createRewarded.mockReturnValue(ad);
  mocks.createInterstitial.mockReturnValue(fakeAd(() => Promise.resolve()));
  await provider.initAds();

  const outcome = provider.showRewarded('nonce', 'user');
  ad.emit('r-loaded');
  ad.emit('earned');
  ad.emit('closed');
  expect(await outcome).toBe('earned');
  expect(ad.show).toHaveBeenCalledTimes(1);
});
