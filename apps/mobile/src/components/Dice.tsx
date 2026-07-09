/**
 * The game die (Ludo Club look): a white rounded face with inked pips that you
 * TAP to roll when it's your turn — no separate button. Rolling spins/pops the
 * die (2D-only transforms; perspective/rotateX flicker iOS) while rapidly
 * shuffling the shown face, landing on the real value. When tappable it wiggles
 * for attention. The tumble replays on `spinSeq` changes only — never on mount,
 * so the die moving to the next player's corner doesn't re-roll (the old double
 * animation bug).
 */

import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { shade } from "../theme";
import { playDiceRoll } from "../lib/sound";
import { diceSettle } from "../lib/haptics";
import type { BoardTheme } from "../render/boardThemes";

/** Pip centers on a unit face (x, y in 0..1), per die value. */
const PIP_XY: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.26, 0.26], [0.74, 0.74]],
  3: [[0.26, 0.26], [0.5, 0.5], [0.74, 0.74]],
  4: [[0.26, 0.26], [0.74, 0.26], [0.26, 0.74], [0.74, 0.74]],
  5: [[0.26, 0.26], [0.74, 0.26], [0.5, 0.5], [0.26, 0.74], [0.74, 0.74]],
  6: [[0.26, 0.22], [0.74, 0.22], [0.26, 0.5], [0.74, 0.5], [0.26, 0.78], [0.74, 0.78]],
};

const SHUFFLE_MS = 55;
const SHUFFLE_TICKS = 8;

interface DiceProps {
  value: number | null;
  size?: number;
  /** Dim slightly when stale (between turns). */
  muted?: boolean;
  /** Bump to replay the tumble animation. */
  spinSeq?: number;
  /** Board theme supplying face/pip colors (defaults white/ink). */
  theme?: BoardTheme;
  /** When set, the die is tappable (it wiggles) and tapping rolls. */
  onRollPress?: (() => void) | null;
}

export function Dice({ value, size = 64, muted = false, spinSeq = 0, theme, onRollPress = null }: DiceProps) {
  const rot = useSharedValue(0);
  const scale = useSharedValue(1);
  const wiggle = useSharedValue(0);
  const [shown, setShown] = useState<number | null>(value);
  const shuffling = useRef(false);
  const shuffleTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(false);

  // Track the real value whenever we're not mid-shuffle.
  useEffect(() => {
    if (!shuffling.current) setShown(value);
  }, [value]);

  useEffect(() => {
    // Skip on mount: remounting at the next player's corner must not re-roll.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!spinSeq) return;
    playDiceRoll();
    rot.value = withTiming(rot.value + 360, { duration: 560, easing: Easing.out(Easing.cubic) });
    scale.value = withSequence(
      withTiming(1.18, { duration: 150, easing: Easing.out(Easing.quad) }),
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

  // "Tap me" wiggle while the die is waiting to be rolled.
  useEffect(() => {
    if (onRollPress) {
      wiggle.value = withRepeat(
        withSequence(
          withTiming(-1, { duration: 260, easing: Easing.inOut(Easing.quad) }),
          withTiming(1, { duration: 260, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        true,
      );
    } else {
      cancelAnimation(wiggle);
      wiggle.value = withTiming(0, { duration: 120 });
    }
    return () => cancelAnimation(wiggle);
  }, [onRollPress !== null, wiggle]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${rot.value + wiggle.value * 6}deg` },
      { scale: scale.value * (1 + Math.abs(wiggle.value) * 0.04) },
    ],
  }));

  const face = theme?.dice.face ?? "#FFFFFF";
  const pipColor = theme?.dice.pip ?? "#17181C";
  const rounded = size * 0.24;
  const pip = size * 0.17;
  const pips = shown ? PIP_XY[shown]! : [];

  const die = (
    <Animated.View
      accessibilityLabel={shown ? `Dice showing ${shown}` : "Dice"}
      style={[
        {
          width: size,
          height: size,
          borderRadius: rounded,
          backgroundColor: face,
          opacity: muted && !onRollPress ? 0.85 : 1,
          // Bottom edge slightly darker = subtle thickness without 3D transforms.
          borderBottomWidth: 3,
          borderBottomColor: shade(face, -0.25),
          shadowColor: "#000",
          shadowOpacity: 0.3,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        },
        animatedStyle,
      ]}
    >
      {pips.map(([px, py], i) => (
        <View
          key={i}
          style={{
            position: "absolute",
            left: px * size - pip / 2,
            top: py * (size - 3) - pip / 2,
            width: pip,
            height: pip,
            borderRadius: pip / 2,
            backgroundColor: pipColor,
          }}
        />
      ))}
    </Animated.View>
  );

  if (!onRollPress) return die;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Roll the dice" onPress={onRollPress} hitSlop={10}>
      {die}
    </Pressable>
  );
}
