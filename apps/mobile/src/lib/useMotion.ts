/**
 * The live motion tier: turns the device's capabilities, the OS accessibility
 * setting, and the player's own preference into the one value components read.
 *
 * Thin wrapper over the pure helper in motionTier.ts (kept separate so that
 * stays Node-testable without pulling in react-native), exactly as useLayout.ts
 * wraps layout.ts.
 */

import { deviceYearClass, totalMemory } from "expo-device";
import { useReducedMotion } from "react-native-reanimated";
import { motionTier, type MotionTier } from "./motionTier";
import { useSettings } from "../store/settingsStore";

/**
 * The tier this device should animate at.
 *
 * `totalMemory` and `deviceYearClass` are module constants — they are read once
 * at native startup and cannot change while the app runs — so there is nothing
 * to subscribe to and nothing to memoize. The two values that DO change (the OS
 * setting and the player's preference) each come from a hook that re-renders
 * the caller when they do.
 */
export function useMotion(): MotionTier {
  const osReduceMotion = useReducedMotion();
  const override = useSettings((s) => s.motionPref);
  return motionTier({
    totalMemoryBytes: totalMemory,
    deviceYear: deviceYearClass,
    osReduceMotion,
    override,
  });
}

/** True when this device should spend the full animation budget. */
export function useFullMotion(): boolean {
  return useMotion() === "full";
}
