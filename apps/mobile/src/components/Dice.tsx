/**
 * A die that rests as a clean flat face and comes alive while rolling. The roll
 * spins and pops the die (2D-only transforms — no perspective/rotateX, which
 * force offscreen compositing and flicker the screen on iOS) while rapidly
 * shuffling the shown pips, so it reads as a real tumble, then lands on `value`.
 * The tumble retriggers whenever `spinSeq` changes (so even two 6s animate).
 */

import { useEffect, useRef, useState } from "react";
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

const SHUFFLE_MS = 55;
const SHUFFLE_TICKS = 8;

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
  const rot = useSharedValue(0);
  const scale = useSharedValue(1);
  const [shown, setShown] = useState<number | null>(value);
  const shuffling = useRef(false);
  const shuffleTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Track the real value whenever we're not mid-shuffle.
  useEffect(() => {
    if (!shuffling.current) setShown(value);
  }, [value]);

  useEffect(() => {
    if (!spinSeq) return;
    playDiceRoll();
    rot.value = withTiming(rot.value + 360, { duration: 560, easing: Easing.out(Easing.cubic) });
    scale.value = withSequence(
      withTiming(1.16, { duration: 150, easing: Easing.out(Easing.quad) }),
      withTiming(0.94, { duration: 120, easing: Easing.inOut(Easing.quad) }),
      withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) }),
    );

    // Rapid face shuffle → lands on the real value.
    shuffling.current = true;
    let ticks = 0;
    if (shuffleTimer.current) clearInterval(shuffleTimer.current);
    shuffleTimer.current = setInterval(() => {
      ticks += 1;
      if (ticks >= SHUFFLE_TICKS) {
        if (shuffleTimer.current) clearInterval(shuffleTimer.current);
        shuffleTimer.current = null;
        shuffling.current = false;
        setShown(value);
      } else {
        setShown(1 + Math.floor(Math.random() * 6));
      }
    }, SHUFFLE_MS);

    const settle = setTimeout(diceSettle, SHUFFLE_MS * SHUFFLE_TICKS);
    return () => {
      clearTimeout(settle);
      if (shuffleTimer.current) {
        clearInterval(shuffleTimer.current);
        shuffleTimer.current = null;
      }
      shuffling.current = false;
    };
  }, [spinSeq, value, rot, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rot.value}deg` }, { scale: scale.value }],
  }));

  const face = theme?.dice.face ?? "#FFFFFF";
  const pipColor = theme?.dice.pip ?? "#17181C";
  const rounded = size * 0.2;
  const filled = shown ? new Set(PIPS[shown]) : new Set<number>();
  const pip = size * 0.15;

  return (
    <Animated.View
      accessibilityLabel={shown ? `Dice showing ${shown}` : "Dice"}
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
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        },
        animatedStyle,
      ]}
    >
      {/* Subtle bevel: light top edge, shadowed bottom edge (2D, no compositing). */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          borderRadius: rounded,
          borderTopWidth: 1.5,
          borderTopColor: "rgba(255,255,255,0.7)",
          borderBottomWidth: 2,
          borderBottomColor: "rgba(0,0,0,0.12)",
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
