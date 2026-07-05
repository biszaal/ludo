/**
 * Ludo wordmark — four rounded color tiles (L U D O) in the player colors, each
 * tilted for play and bobbing on a gentle staggered wave. Tactile and game-native,
 * readable on the dark felt. Design taste adapted from the gpt-taste skill
 * (Outfit type, intentional color, perpetual micro-motion) for React Native.
 */

import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { teamColor, font } from "../theme";
import type { Color as PlayerColor } from "@ludo/engine";

const LETTERS: { char: string; color: PlayerColor }[] = [
  { char: "L", color: "red" },
  { char: "U", color: "green" },
  { char: "D", color: "yellow" },
  { char: "O", color: "blue" },
];
const BASE_TILT = [-6, 4, -4, 6];

interface LogoProps {
  /** Tile edge length in px. */
  tile?: number;
}

export function Logo({ tile = 56 }: LogoProps) {
  const wave = useSharedValue(0);
  useEffect(() => {
    wave.value = withRepeat(withTiming(1, { duration: 2800, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(wave);
  }, [wave]);

  return (
    <View style={styles.row} accessibilityLabel="Ludo" accessibilityRole="header">
      {LETTERS.map((l, i) => (
        <LetterTile key={l.char} char={l.char} color={teamColor[l.color]} index={i} tile={tile} wave={wave} />
      ))}
    </View>
  );
}

function LetterTile({
  char,
  color,
  index,
  tile,
  wave,
}: {
  char: string;
  color: string;
  index: number;
  tile: number;
  wave: SharedValue<number>;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    const phase = index * 0.16;
    const angle = (wave.value + phase) * Math.PI * 2;
    return {
      transform: [{ translateY: Math.sin(angle) * 5 }, { rotate: `${BASE_TILT[index]! + Math.sin(angle) * 2.5}deg` }],
    };
  });

  return (
    <Animated.View
      style={[
        styles.tile,
        {
          width: tile,
          height: tile,
          borderRadius: tile * 0.26,
          marginHorizontal: tile * 0.05,
          backgroundColor: color,
        },
        animatedStyle,
      ]}
    >
      <Text style={[styles.letter, { fontSize: tile * 0.56 }]}>{char}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  tile: {
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 4,
    borderBottomColor: "rgba(0,0,0,0.22)",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 5 },
    elevation: 7,
  },
  letter: {
    fontFamily: font.display,
    color: "#FFFFFF",
    textShadowColor: "rgba(0,0,0,0.25)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    marginTop: -2,
  },
});
