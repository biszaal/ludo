/**
 * A 3D-looking die (the Ludo Club look): a bright face resting at a slight tilt
 * with a darker under-edge for cube thickness and a soft drop shadow. Rolling
 * does one clean tumble that settles back to the tilt — no wild spinning. Shows
 * pips for `value` (1–6); the tumble retriggers whenever `spinSeq` changes (so
 * even two 6s in a row animate).
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
import { shade } from "../theme";
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

/** Resting tilt (deg) — the die sits at an angle so it reads as a solid cube. */
const REST_TILT = -12;

interface DiceProps {
  value: number | null;
  size?: number;
  /** Dim the face when it's stale (between turns). */
  muted?: boolean;
  /** Kept for API compatibility; the reference die has no colored border. */
  accent?: string;
  /** Bump this to replay the tumble animation. */
  spinSeq?: number;
  /** Board theme supplying the die's face/pip colors (defaults to white/ink). */
  theme?: BoardTheme;
}

export function Dice({ value, size = 64, muted = false, spinSeq = 0, theme }: DiceProps) {
  const rot = useSharedValue(REST_TILT);
  const scale = useSharedValue(1);

  useEffect(() => {
    if (!spinSeq) return;
    playDiceRoll();
    // One full turn each roll: +360 keeps the resting tilt but tumbles once.
    rot.value = withTiming(rot.value + 360, { duration: 520, easing: Easing.out(Easing.cubic) });
    scale.value = withSequence(
      withTiming(1.08, { duration: 150, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }),
    );
    // Haptic lands as the tumble settles (DESIGN.md §6: tap on settle).
    const settle = setTimeout(diceSettle, 450);
    return () => clearTimeout(settle);
  }, [spinSeq, rot, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rot.value}deg` }, { scale: scale.value }],
  }));

  const face = theme?.dice.face ?? "#FFFFFF";
  const pipColor = theme?.dice.pip ?? "#17181C";
  const edge = shade(face, -0.2); // darker under-edge = cube thickness
  const depth = Math.round(size * 0.16);
  const rounded = size * 0.22;
  const filled = value ? new Set(PIPS[value]) : new Set<number>();
  const pip = size * 0.15;

  return (
    <Animated.View
      accessibilityLabel={value ? `Dice showing ${value}` : "Dice"}
      style={[{ width: size, height: size + depth, opacity: muted ? 0.55 : 1 }, animatedStyle]}
    >
      {/* Under-edge: the visible bottom of the cube (thickness). */}
      <View
        style={{
          position: "absolute",
          left: 0,
          top: depth,
          width: size,
          height: size,
          borderRadius: rounded,
          backgroundColor: edge,
        }}
      />
      {/* Top face with pips. */}
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: size,
          height: size,
          borderRadius: rounded,
          backgroundColor: face,
          padding: size * 0.16,
          flexDirection: "row",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignContent: "space-between",
          shadowColor: "#000",
          shadowOpacity: 0.35,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 6 },
          elevation: 8,
        }}
      >
        {/* Sheen catching the top-left of the face. */}
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: "42%",
            borderTopLeftRadius: rounded,
            borderTopRightRadius: rounded,
            backgroundColor: "rgba(255,255,255,0.35)",
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
                  backgroundColor: pipColor,
                  // A dark ring reads as a drilled pip, not a printed dot.
                  borderWidth: 1,
                  borderColor: "rgba(0,0,0,0.25)",
                }}
              />
            )}
          </View>
        ))}
      </View>
    </Animated.View>
  );
}
