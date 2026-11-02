/**
 * Frenzy's recharge bar under the local player's die: it fills from the moment
 * the pawn lands to the moment the die may roll again.
 *
 * Compositor-only (a scaleX on a plain view), kept well away from the dice and
 * board pictures — a per-frame value inside a Skia picture re-records the whole
 * canvas every frame, which is the judder this app has already paid for twice.
 * The slot is always laid out and only fades, so the chip row never shifts when
 * the bar comes and goes.
 */

import { useEffect } from "react";
import { View } from "react-native";
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";

interface RechargeMeterProps {
  /** Epoch ms the recharge starts filling (the pawn has landed). */
  from: number;
  /** Epoch ms the die may roll again. */
  until: number;
  visible: boolean;
  width: number;
  color: string;
}

export const RECHARGE_METER_HEIGHT = 4;

export function RechargeMeter({ from, until, visible, width, color }: RechargeMeterProps) {
  const fill = useSharedValue(1);

  useEffect(() => {
    cancelAnimation(fill);
    const now = Date.now();
    if (!visible || until <= from || now >= until) {
      fill.value = 1;
      return;
    }
    const start = Math.max(now, from);
    fill.value = Math.max(0, (start - from) / (until - from));
    fill.value = withDelay(start - now, withTiming(1, { duration: until - start, easing: Easing.linear }));
  }, [fill, from, until, visible]);

  const bar = useAnimatedStyle(() => ({ transform: [{ scaleX: fill.value }] }));

  return (
    <View
      pointerEvents="none"
      style={{
        width,
        height: RECHARGE_METER_HEIGHT,
        borderRadius: RECHARGE_METER_HEIGHT / 2,
        overflow: "hidden",
        backgroundColor: "rgba(255,255,255,0.14)",
        opacity: visible ? 1 : 0,
      }}
    >
      <Animated.View style={[{ width, height: RECHARGE_METER_HEIGHT, backgroundColor: color, transformOrigin: "left" }, bar]} />
    </View>
  );
}
