/**
 * A physical die that tumbles when rolled. Shows pips for `value` (1–6); the
 * spin is retriggered whenever `spinSeq` changes (so even two 6s in a row
 * animate). A thin accent border picks up the current player's color.
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
import { palette, radius } from "../theme";
import { playDiceRoll } from "../lib/sound";
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
  /** Dim the face when it's stale (between turns). */
  muted?: boolean;
  /** Border accent (usually the current player's color). */
  accent?: string;
  /** Bump this to replay the tumble animation. */
  spinSeq?: number;
  /** Board theme supplying the die's face/pip colors (defaults to chrome). */
  theme?: BoardTheme;
}

export function Dice({ value, size = 64, muted = false, accent, spinSeq = 0, theme }: DiceProps) {
  const rotate = useSharedValue(0);
  const scale = useSharedValue(1);

  useEffect(() => {
    if (!spinSeq) return;
    playDiceRoll();
    rotate.value = 0;
    rotate.value = withTiming(540, { duration: 520, easing: Easing.out(Easing.cubic) });
    scale.value = withSequence(
      withTiming(1.16, { duration: 150, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }),
    );
  }, [spinSeq, rotate, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotate.value}deg` }, { scale: scale.value }],
  }));

  const filled = value ? new Set(PIPS[value]) : new Set<number>();
  const pip = size * 0.15;

  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius.md,
          backgroundColor: theme?.dice.face ?? palette.liftedSlate,
          borderWidth: 2,
          borderColor: accent ?? palette.hairline,
          padding: size * 0.17,
          opacity: muted ? 0.5 : 1,
          flexDirection: "row",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignContent: "space-between",
          shadowColor: "#000",
          shadowOpacity: 0.3,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 3 },
          elevation: 5,
        },
        animatedStyle,
      ]}
    >
      {Array.from({ length: 9 }, (_unused, i) => (
        <View key={i} style={{ width: pip, height: pip, alignItems: "center", justifyContent: "center" }}>
          {filled.has(i) && (
            <View style={{ width: pip, height: pip, borderRadius: pip / 2, backgroundColor: theme?.dice.pip ?? palette.porcelain }} />
          )}
        </View>
      ))}
    </Animated.View>
  );
}
