/**
 * Ad unit IDs, per platform. Development builds always use Google's test units
 * — pointing a debug build at live units is the classic way to get an AdMob
 * account suspended for invalid traffic.
 */

import { Platform } from "react-native";
import { adsSdk } from "./native";

export type BannerSlot = "home" | "lobby";

const LIVE = {
  ios: {
    bannerHome: "ca-app-pub-5089744184168259/5200921985",
    bannerLobby: "ca-app-pub-5089744184168259/7786988658",
    interstitial: "ca-app-pub-5089744184168259/6147172148",
    rewarded: "ca-app-pub-5089744184168259/1737153841",
  },
  android: {
    bannerHome: "ca-app-pub-5089744184168259/9424072170",
    bannerLobby: "ca-app-pub-5089744184168259/1984565850",
    interstitial: "ca-app-pub-5089744184168259/4151564196",
    rewarded: "ca-app-pub-5089744184168259/8358402519",
  },
} as const;

const live = Platform.OS === "ios" ? LIVE.ios : LIVE.android;

/** Test IDs live on the SDK. Without it nothing can request an ad anyway, so the
 *  empty string is only ever a placeholder that never reaches a real request. */
const testIds = adsSdk?.TestIds;

export function bannerUnitId(slot: BannerSlot): string {
  if (__DEV__) return testIds?.BANNER ?? "";
  return slot === "home" ? live.bannerHome : live.bannerLobby;
}

export function interstitialUnitId(): string {
  return __DEV__ ? testIds?.INTERSTITIAL ?? "" : live.interstitial;
}

export function rewardedUnitId(): string {
  return __DEV__ ? testIds?.REWARDED ?? "" : live.rewarded;
}

/**
 * Physical devices that should always receive test ads. A real device running a
 * release build is otherwise indistinguishable from a real user, and tapping
 * your own live ads is exactly what gets an account flagged.
 *
 * Add the ID the SDK prints on first run: "Use RequestConfiguration.Builder
 * .setTestDeviceIds(Arrays.asList("33BE2250B43518CCDA7DE426D04EE231"))".
 */
export const TEST_DEVICE_IDS: string[] = [];
