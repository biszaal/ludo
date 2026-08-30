/**
 * Whether expo-notifications can be loaded at all on this runtime.
 *
 * Not "may we send a notification" — whether the module can be IMPORTED without
 * taking the app down. expo-notifications' index re-exports
 * `DevicePushTokenAutoRegistration.fx`, a side-effect module that calls
 * `addPushTokenListener` at module scope. Since SDK 53 that call runs
 * `warnOfExpoGoPushUsage`, which in Expo Go *throws on Android* (on every other
 * platform it only console.warns). So a plain top-level
 * `import * as Notifications from "expo-notifications"` is enough to crash the
 * app on launch under Expo Go on Android, before any of our code runs — which
 * is exactly what it did.
 *
 * Pure and dependency-light (no react-native, no expo import) so the Node test
 * suite can exercise the rule, the same split layout.ts / motionTier.ts use.
 */

export interface RuntimeSignals {
  /** react-native's Platform.OS. */
  platform: string;
  /** expo's isRunningInExpoGo(). */
  inExpoGo: boolean;
}

/**
 * True when importing expo-notifications is safe.
 *
 * Android + Expo Go is the one combination that throws. Everything else — a
 * development build or a store build on either platform, and Expo Go on iOS —
 * loads fine, so the reminder and the tap router keep working there.
 */
export function canLoadNotifications({ platform, inExpoGo }: RuntimeSignals): boolean {
  return !(platform === "android" && inExpoGo);
}
