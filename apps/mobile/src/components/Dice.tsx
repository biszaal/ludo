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
    rotate.value = withTiming(360, { duration: 520, easing: Easing.out(Easing.cubic) });
    scale.value = withSequence(
      withTiming(1.08, { duration: 150, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }),
    );
    // Haptic lands as the tumble settles (DESIGN.md §6: tap on settle).
    const settle = setTimeout(diceSettle, 450);
    return () => clearTimeout(settle);
  }, [spinSeq, rotate, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotate.value}deg` }, { scale: scale.value }],
  }));

  const filled = value ? new Set(PIPS[value]) : new Set<number>();
  const pip = size * 0.15;

  return (
    <Animated.View
      accessibilityLabel={value ? `Dice showing ${value}` : "Dice"}
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
          shadowOpacity: 0.35,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        },
        animatedStyle,
      ]}
    >
      {/* Bevel: light catches the top edge, the bottom edge falls into shadow. */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          borderRadius: radius.md - 2,
          borderTopWidth: 1.5,
          borderTopColor: "rgba(255,255,255,0.16)",
          borderBottomWidth: 2.5,
          borderBottomColor: "rgba(0,0,0,0.30)",
        }}
      />
      {/* Sheen across the upper half of the face. */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: "48%",
          borderTopLeftRadius: radius.md - 2,
          borderTopRightRadius: radius.md - 2,
          backgroundColor: "rgba(255,255,255,0.05)",
        }}
      />
      {Array.from({ length: 9 }, (_unused, i) => (
        <View key={i} style={{ width: pip, height: pip, alignItems: "center", justifyContent: "center" }}>
          {filled.has(i) && (
            <View
              style={{
                width: pip,
                height: pip,
                borderRadius: pip / 2,
                backgroundColor: theme?.dice.pip ?? palette.porcelain,
                // A dark ring reads as a drilled pip, not a printed dot.
                borderWidth: 1,
                borderColor: "rgba(0,0,0,0.25)",
              }}
            />
          )}
        </View>
      ))}
    </Animated.View>
  );
}
