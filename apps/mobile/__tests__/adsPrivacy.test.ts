import { beforeEach, it, expect, vi } from 'vitest';
const mocks=vi.hoisted(()=>({gather:vi.fn(),cached:vi.fn(),form:vi.fn(),initialize:vi.fn(),createAd:vi.fn()}));
vi.mock('react-native',()=>({Platform:{OS:'android'}}));
vi.mock('expo-tracking-transparency',()=>({getTrackingPermissionsAsync:vi.fn(),requestTrackingPermissionsAsync:vi.fn()}));
vi.mock('../src/lib/ads/units',()=>({TEST_DEVICE_IDS:[],interstitialUnitId:()=> 'test',rewardedUnitId:()=> 'test'}));
vi.mock('../src/lib/ads/native',()=>({adsSdk:{
  AdsConsent:{gatherConsent:mocks.gather,getConsentInfo:mocks.cached,showPrivacyOptionsForm:mocks.form},
  default:()=>({initialize:mocks.initialize}),
  InterstitialAd:{createForAdRequest:mocks.createAd},AdEventType:{LOADED:'loaded',ERROR:'error'},
}}));
let provider: typeof import('../src/lib/ads/provider');
const info=(allowed:boolean)=>({status:'OBTAINED',canRequestAds:allowed,privacyOptionsRequirementStatus:'REQUIRED'});
beforeEach(async()=>{
  vi.resetModules(); vi.resetAllMocks();
  mocks.gather.mockResolvedValue(info(true)); mocks.form.mockResolvedValue(info(false));
  mocks.createAd.mockReturnValue({addAdEventListener:()=>()=>{},load:vi.fn()});
  provider=await import('../src/lib/ads/provider');
});
it('unknown consent neither initializes nor preloads ads',async()=>{
  mocks.gather.mockRejectedValue(new Error('offline'));mocks.cached.mockRejectedValue(new Error('offline'));
  await provider.initAds();
  expect(provider.adsReady()).toBe(false);
  expect(mocks.initialize).not.toHaveBeenCalled();expect(mocks.createAd).not.toHaveBeenCalled();
});
it('notifies Settings when privacy choices are required even if ads are denied',async()=>{
  mocks.gather.mockResolvedValue(info(false));const changed=vi.fn();provider.subscribeAdsReady(changed);
  await provider.initAds();
  expect(provider.adsPrivacyRequired()).toBe(true);expect(changed).toHaveBeenCalled();
  expect(provider.adsReady()).toBe(false);
});
it('revoking consent disables requests and prevents reusing a preloaded ad',async()=>{
  await provider.initAds();expect(provider.adsReady()).toBe(true);
  expect(await provider.showAdsPrivacyOptions()).toBe(true);
  expect(provider.adsReady()).toBe(false);
  expect(await provider.showInterstitial()).toBe(false);
  expect(mocks.createAd).toHaveBeenCalledTimes(1);
});
it('privacy-form errors keep requests paused',async()=>{
  await provider.initAds();mocks.form.mockRejectedValue(new Error('offline'));
  expect(await provider.showAdsPrivacyOptions()).toBe(false);
  expect(provider.adsReady()).toBe(false);
});
