/**
 * A reaction emoji that pops over its sender's player panel, drifts up and
 * fades on a plain timing curve (no bounce). Re-fires whenever `seq` changes;
 * unmounts its content when the run ends so stale reactions never linger.
 */

import { useEffect, useState } from "react";
import { Text } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

const RUN_MS = 1800;

export function ReactionBubble({ value, seq }: { value: string; seq: number }) {
  const progress = useSharedValue(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(true);
    progress.value = 0;
    progress.value = withTiming(1, { duration: RUN_MS, easing: Easing.out(Easing.quad) });
    const t = setTimeout(() => setVisible(false), RUN_MS + 80);
    return () => clearTimeout(t);
  }, [seq, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value < 0.12 ? progress.value / 0.12 : 1 - (progress.value - 0.12) / 0.88,
    transform: [
      { translateY: -8 - progress.value * 24 },
      { scale: 0.7 + Math.min(progress.value * 5, 1) * 0.3 },
    ],
  }));

  if (!visible) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: "absolute", top: -6, left: 0, right: 0, alignItems: "center", zIndex: 10 }, style]}
    >
      <Text style={{ fontSize: 30 }}>{value}</Text>
    </Animated.View>
  );
}
