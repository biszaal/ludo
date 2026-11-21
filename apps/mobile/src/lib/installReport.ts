/**
 * Native wiring for the install source and device reports (lib/installSource,
 * lib/deviceId). Import this ONLY from App.tsx: it pulls in native modules the
 * Node test suite cannot load.
 *
 * Runs at launch and on each return to the foreground. Both reports remember
 * what they sent, so after the first success each run is a local read only;
 * the foreground pass picks up an account switched to mid-session.
 */

import { AppState, Platform } from "react-native";
import * as Application from "expo-application";
import * as SecureStore from "expo-secure-store";
import { kvStorage } from "./storage";
import { reportInstallOnce } from "./installSource";
import { deviceIdFor, randomId, reportDeviceOnce } from "./deviceId";
import { ensureSignedIn, reportDevice, reportInstallSource } from "../net/api";
import { useReferrals } from "../store/referralStore";

const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const keychain = {
  getItem: (key: string) => SecureStore.getItemAsync(key, KEYCHAIN_OPTIONS),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value, KEYCHAIN_OPTIONS),
};

let running = false;

async function run(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const store = kvStorage();
    await reportInstallOnce({
      platform: Platform.OS,
      readReferrer: () => Application.getInstallReferrerAsync(),
      send: async (platform, referrer) => {
        const result = await reportInstallSource(platform, referrer);
        // A friend's link just recorded a referral: the invite card should say so.
        if (result.referral?.attached) void useReferrals.getState().load({ force: true });
        return result;
      },
      store,
    });
    const userId = await ensureSignedIn();
    await reportDeviceOnce(userId, {
      deviceId: () =>
        deviceIdFor(Platform.OS, {
          androidId: () => (Platform.OS === "android" ? Application.getAndroidId() : null),
          keychain,
          newId: randomId,
        }),
      send: reportDevice,
      store,
    });
  } catch {
    // Offline or not signed in yet; the next launch or foreground tries again.
  } finally {
    running = false;
  }
}

/** Call once from App; returns an unsubscribe. */
export function initInstallReports(): () => void {
  void run();
  const sub = AppState.addEventListener("change", (state) => {
    if (state === "active") void run();
  });
  return () => sub.remove();
}
