/**
 * The only module that touches the ad SDK. Everything else imports from here,
 * mirroring the lib/sound.ts boundary — so the stores stay pure and testable in
 * Node, and a missing/failed SDK degrades to "no ads" instead of crashing.
 *
 * Every export is best-effort and never throws.
 *
 * Consent ordering matters and is easy to get wrong: UMP must resolve BEFORE
 * mobileAds().initialize(), or the first ad requests go out without a legal
 * basis in the EEA.
 */

import { Platform } from "react-native";
// Type-only: erased at compile time, so it can never pull the native module in.
import type { InterstitialAd } from "react-native-google-mobile-ads";
import { getTrackingPermissionsAsync, requestTrackingPermissionsAsync } from "expo-tracking-transparency";
import { adsSdk } from "./native";
import { interstitialUnitId, rewardedUnitId, TEST_DEVICE_IDS } from "./units";

let initialized = false;
let canRequestAds = false;

/**
 * Readiness is asynchronous — UMP consent, the ATT prompt and SDK startup can
 * take seconds — so it has to be *observable*, not just readable.
 *
 * Every ad surface mounts long before initAds() resolves. When this was a bare
 * function call, those components read `false` once and were never re-rendered
 * by anything, so the banners stayed hidden for the whole session even after
 * the SDK came up. useSyncExternalStore + this listener set is what turns
 * "ready" into something React can actually react to.
 */
const listeners = new Set<() => void>();

function setReady(next: { initialized?: boolean; canRequestAds?: boolean }): void {
  const was = adsReady();
  if (next.initialized !== undefined) initialized = next.initialized;
  if (next.canRequestAds !== undefined) canRequestAds = next.canRequestAds;
  if (adsReady() !== was) for (const l of listeners) l();
}

/** Subscribe to readiness changes. Pair with adsReady in useSyncExternalStore. */
export function subscribeAdsReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the SDK is up and consent allows requests. */
export function adsReady(): boolean {
  return initialized && canRequestAds;
}

/**
 * Gather consent, then start the SDK. Safe to call more than once.
 */
export async function initAds(): Promise<void> {
  if (initialized) return;
  // No native module in this binary (Expo Go): stay uninitialized so adsReady()
  // reports false and every entry point below no-ops.
  const sdk = adsSdk;
  if (!sdk) return;
  try {
    // 1. UMP: this presents the GDPR/consent form where one is required, and
    //    is a no-op elsewhere.
    try {
      const info = await sdk.AdsConsent.gatherConsent({
        testDeviceIdentifiers: TEST_DEVICE_IDS,
      });
      setReady({ canRequestAds: info.canRequestAds });
    } catch {
      // Consent flow unavailable (offline, misconfigured form). Fall back to
      // requesting ads without personalization rather than showing nothing.
      setReady({ canRequestAds: true });
    }

    // 2. iOS ATT. UMP usually presents this itself when the AdMob console is
    //    configured to; this covers the case where it didn't.
    if (Platform.OS === "ios") {
      try {
        const current = await getTrackingPermissionsAsync();
        if (current.status === "undetermined") await requestTrackingPermissionsAsync();
      } catch {
        // Denied or unavailable — ads still serve, just non-personalized.
      }
    }

    // 3. Only now start the SDK.
    if (TEST_DEVICE_IDS.length > 0) {
      await sdk.default().setRequestConfiguration({ testDeviceIdentifiers: TEST_DEVICE_IDS });
    }
    await sdk.default().initialize();
    setReady({ initialized: true });
    // Warm the first interstitial now that requests are legal.
    preloadInterstitial();
  } catch {
    setReady({ initialized: false });
  }
}

// --- Interstitial ------------------------------------------------------------
// Kept warm so the match-end seam never waits on a network round trip. Ludo
// matches run 3-15 minutes, so there's ample time to preload.

let interstitial: InterstitialAd | null = null;
let interstitialLoaded = false;

export function preloadInterstitial(): void {
  const sdk = adsSdk;
  if (!sdk || !adsReady() || interstitial) return;
  try {
    const ad = sdk.InterstitialAd.createForAdRequest(interstitialUnitId());
    interstitial = ad;
    interstitialLoaded = false;
    const offLoaded = ad.addAdEventListener(sdk.AdEventType.LOADED, () => {
      interstitialLoaded = true;
    });
    const offError = ad.addAdEventListener(sdk.AdEventType.ERROR, () => {
      interstitialLoaded = false;
      interstitial = null;
      offLoaded();
      offError();
    });
    ad.load();
  } catch {
    interstitial = null;
  }
}

/**
 * Show the preloaded interstitial. Resolves true only if one was actually
 * shown. Never blocks the caller's flow: an unloaded or failed ad resolves
 * false immediately so the UI proceeds.
 */
export function showInterstitial(): Promise<boolean> {
  const sdk = adsSdk;
  if (!sdk || !adsReady() || !interstitial || !interstitialLoaded) {
    preloadInterstitial();
    return Promise.resolve(false);
  }
  const ad = interstitial;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (shown: boolean) => {
      if (settled) return;
      settled = true;
      interstitial = null;
      interstitialLoaded = false;
      preloadInterstitial(); // warm the next one
      resolve(shown);
    };
    try {
      const offClosed = ad.addAdEventListener(sdk.AdEventType.CLOSED, () => {
        offClosed();
        finish(true);
      });
      const offError = ad.addAdEventListener(sdk.AdEventType.ERROR, () => {
        offError();
        finish(false);
      });
      ad.show();
    } catch {
      finish(false);
    }
  });
}

// --- Rewarded ----------------------------------------------------------------

export type RewardedOutcome = "earned" | "dismissed" | "failed";

/**
 * Show a rewarded ad tied to a server-minted nonce.
 *
 * `nonce` goes out as SSV customData; the server matches it to the pending
 * ad_rewards row when AdMob's signed callback arrives. "earned" here means the
 * SDK saw the reward event — it is NOT proof of payment and must never be used
 * to credit coins client-side. Poll adRewardStatus for that.
 */
export function showRewarded(nonce: string, userId: string): Promise<RewardedOutcome> {
  const sdk = adsSdk;
  if (!sdk || !adsReady()) return Promise.resolve("failed");
  return new Promise<RewardedOutcome>((resolve) => {
    let earned = false;
    let settled = false;
    const finish = (outcome: RewardedOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    try {
      const ad = sdk.RewardedAd.createForAdRequest(rewardedUnitId(), {
        serverSideVerificationOptions: { userId, customData: nonce },
      });

      const offLoaded = ad.addAdEventListener(sdk.RewardedAdEventType.LOADED, () => {
        offLoaded();
        try {
          ad.show();
        } catch {
          finish("failed");
        }
      });
      ad.addAdEventListener(sdk.RewardedAdEventType.EARNED_REWARD, () => {
        earned = true;
      });
      ad.addAdEventListener(sdk.AdEventType.CLOSED, () => finish(earned ? "earned" : "dismissed"));
      ad.addAdEventListener(sdk.AdEventType.ERROR, () => finish("failed"));

      ad.load();
    } catch {
      finish("failed");
    }
  });
}
