/**
 * The one runtime combination that cannot load expo-notifications.
 *
 * This rule is load-bearing in a way most feature flags are not: get it wrong
 * in the permissive direction and the app throws during module evaluation on
 * launch, with no chance to catch it. Get it wrong in the restrictive direction
 * and everyone silently loses their daily-bonus reminder. So both directions
 * are pinned here.
 */

import { describe, expect, it } from "vitest";
import { canLoadNotifications } from "../src/lib/notificationSupport";

describe("canLoadNotifications", () => {
  it("refuses Expo Go on Android — importing the module throws there", () => {
    expect(canLoadNotifications({ platform: "android", inExpoGo: true })).toBe(false);
  });

  it("allows Expo Go on iOS, where the same call only warns", () => {
    expect(canLoadNotifications({ platform: "ios", inExpoGo: true })).toBe(true);
  });

  it("allows a real Android build — Expo Go is the only broken host", () => {
    expect(canLoadNotifications({ platform: "android", inExpoGo: false })).toBe(true);
  });

  it("allows a real iOS build", () => {
    expect(canLoadNotifications({ platform: "ios", inExpoGo: false })).toBe(true);
  });
});
