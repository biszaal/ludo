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
import { useRefreshHz } from "./useRefreshRate";
import { useSettings } from "../store/settingsStore";

/**
 * The tier this device should animate at.
 *
 * `totalMemory` and `deviceYearClass` are module constants — they are read once
 * at native startup and cannot change while the app runs — so there is nothing
 * to subscribe to and nothing to memoize. The three values that DO change (the
 * OS setting, the player's preference, and the refresh rate once its probe
 * lands) each come from a hook that re-renders the caller when they do.
 *
 * The refresh rate is null for the first second and a half of a launch, which
 * motionTier reads as an ordinary display. On the devices the high-refresh rule
 * actually catches — budget Androids with a 120Hz panel and under 6GB of RAM —
 * that means the tier drops from full to reduced shortly after startup, and the
 * idle loops stop. It happens once, during loading, on precisely the phones
 * that could not afford to keep running them.
 */
export function useMotion(): MotionTier {
  const osReduceMotion = useReducedMotion();
  const override = useSettings((s) => s.motionPref);
  const refreshHz = useRefreshHz();
  return motionTier({
    totalMemoryBytes: totalMemory,
    deviceYear: deviceYearClass,
    osReduceMotion,
    refreshHz,
    override,
  });
}

/** True when this device should spend the full animation budget. */
export function useFullMotion(): boolean {
  return useMotion() === "full";
}
