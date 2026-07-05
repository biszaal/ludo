/**
 * Haptics, gated by settings.hapticsOn. Best-effort: no-ops on devices without
 * an engine (simulator, some Androids). Intensity maps to game weight — light
 * for touches, medium for the dice settle, heavy for captures, success for wins.
 */

import * as Haptics from "expo-haptics";
import { useSettings } from "../store/settingsStore";

function enabled(): boolean {
  return useSettings.getState().hapticsOn;
}

export function tapLight(): void {
  if (enabled()) void Haptics.selectionAsync().catch(() => {});
}

export function diceSettle(): void {
  if (enabled()) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export function capture(): void {
  if (enabled()) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
}

export function win(): void {
  if (enabled()) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

// Hop ticks fire per cell — throttle to every other hop so long moves don't buzz.
let hopCount = 0;

export function hopTick(): void {
  hopCount += 1;
  if (hopCount % 2 === 0 && enabled()) void Haptics.selectionAsync().catch(() => {});
}
