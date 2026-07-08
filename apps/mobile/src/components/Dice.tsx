/**
 * A die that rests as a clean flat (2D) face and tumbles in 3D while rolling.
 * At rest it's a bright rounded square with pips and a soft shadow; on a roll it
 * spins on two axes in perspective (a real cube tumble) and settles back flat.
 * Shows pips for `value` (1–6); the tumble retriggers whenever `spinSeq` changes
 * (so even two 6s in a row animate).
 */

import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { playDiceRoll } from "../lib/sound";
import { diceSettle } from "../lib/haptics";
import type { BoardTheme } from "../render/boardThemes";

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

interface DiceProps {
  value: number | null;
  size?: number;
  /** Dim the face slightly when it's stale (between turns). */
  muted?: boolean;
  /** Kept for API compatibility; the reference die has no colored border. */
  accent?: string;
  /** Bump this to replay the tumble animation. */
  spinSeq?: number;
  /** Board theme supplying the die's face/pip colors (defaults to white/ink). */
  theme?: BoardTheme;
}

export function Dice({ value, size = 64, muted = false, spinSeq = 0, theme }: DiceProps) {
  // Rotations stay at multiples of 360 at rest, so the die always settles flat.
  const rx = useSharedValue(0);
  const ry = useSharedValue(0);
  const scale = useSharedValue(1);

  useEffect(() => {
    if (!spinSeq) return;
    playDiceRoll();
    rx.value = withTiming(rx.value + 360, { duration: 620, easing: Easing.out(Easing.cubic) });
    ry.value = withTiming(ry.value + 720, { duration: 620, easing: Easing.out(Easing.cubic) });
    scale.value = withSequence(
      withTiming(1.14, { duration: 170, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }),
    );
    // Haptic lands as the tumble settles (DESIGN.md §6: tap on settle).
    const settle = setTimeout(diceSettle, 500);
    return () => clearTimeout(settle);
  }, [spinSeq, rx, ry, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 800 },
      { rotateX: `${rx.value}deg` },
      { rotateY: `${ry.value}deg` },
      { scale: scale.value },
    ],
  }));

  const face = theme?.dice.face ?? "#FFFFFF";
  const pipColor = theme?.dice.pip ?? "#17181C";
  const rounded = size * 0.2;
  const filled = value ? new Set(PIPS[value]) : new Set<number>();
  const pip = size * 0.15;

  return (
    <Animated.View
      accessibilityLabel={value ? `Dice showing ${value}` : "Dice"}
      style={[
        {
          width: size,
          height: size,
          borderRadius: rounded,
          backgroundColor: face,
          padding: size * 0.16,
          opacity: muted ? 0.9 : 1,
          flexDirection: "row",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignContent: "space-between",
          shadowColor: "#000",
          shadowOpacity: 0.28,
          shadowRadius: 7,
          shadowOffset: { width: 0, height: 5 },
          elevation: 6,
        },
        animatedStyle,
      ]}
    >
      {Array.from({ length: 9 }, (_unused, i) => (
        <View key={i} style={{ width: pip, height: pip, alignItems: "center", justifyContent: "center" }}>
          {filled.has(i) && (
            <View
              style={{
                width: pip,
                height: pip,
                borderRadius: pip / 2,
                backgroundColor: pipColor,
                // A dark ring reads as a drilled pip, not a printed dot.
                borderWidth: 1,
                borderColor: "rgba(0,0,0,0.22)",
              }}
            />
          )}
        </View>
      ))}
    </Animated.View>
  );
}
