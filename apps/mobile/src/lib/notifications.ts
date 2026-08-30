/**
 * The one place expo-notifications is loaded, and the only place allowed to.
 *
 * The import is deferred behind `canLoadNotifications` because on Expo Go for
 * Android the module throws while it is being evaluated — see
 * notificationSupport.ts for exactly why. A static import anywhere in the app
 * puts that throw on the launch path, where nothing can catch it: the app dies
 * on the red screen before App.tsx runs.
 *
 * So push.ts and bonusReminder.ts ask for the module through `notifications()`
 * and do nothing when it comes back null. That keeps the promise both of those
 * files already make — that notifications are an enhancement and never break a
 * game — true of loading them too, not just of calling them.
 *
 * What this costs on Expo Go for Android: no local daily-bonus reminder and no
 * notification-tap routing, for that host only. Remote push is already
 * impossible there (Expo removed it in SDK 53); a development build gets
 * everything back.
 */

import { Platform } from "react-native";
import { isRunningInExpoGo } from "expo";
import { canLoadNotifications } from "./notificationSupport";

type NotificationsModule = typeof import("expo-notifications");

/** Resolved once: `undefined` = not tried yet, `null` = unavailable here. */
let cached: NotificationsModule | null | undefined;

/** True where the module can be used at all. Cheap; safe to call anywhere. */
export function notificationsAvailable(): boolean {
  return canLoadNotifications({ platform: Platform.OS, inExpoGo: isRunningInExpoGo() });
}

/**
 * expo-notifications, or null on a runtime that cannot load it.
 *
 * `require` rather than `import` on purpose — the whole point is that the
 * module must not be pulled in until we have decided it is safe, and a static
 * import is hoisted past any check.
 */
export function notifications(): NotificationsModule | null {
  if (cached !== undefined) return cached;
  if (!notificationsAvailable()) {
    cached = null;
    return cached;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require("expo-notifications") as NotificationsModule;
  } catch {
    // A runtime we did not predict. Silent, like everything else on this path.
    cached = null;
  }
  return cached;
}
