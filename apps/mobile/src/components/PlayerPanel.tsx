/**
 * Compact player status row. The active player's panel lifts and breathes — a
 * slow perpetual pulse of its color ring (DESIGN.md §6); inactive panels
 * recede. Finished-token count is mono.
 */

import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { TOKENS_PER_PLAYER, type GameState, type PlayerState } from "@ludo/engine";
import { font, palette, radius, space, teamColor } from "../theme";

const COLOR_LABEL: Record<PlayerState["color"], string> = {
  red: "Red",
  green: "Green",
  yellow: "Yellow",
  blue: "Blue",
};

interface PlayerPanelProps {
  player: PlayerState;
  state: GameState;
  active: boolean;
  /** Display name override (profiles, "You", bot labels); defaults to the color. */
  label?: string;
}

export function PlayerPanel({ player, state, active, label }: PlayerPanelProps) {
  const finished = state.tokens.filter((t) => t.playerId === player.id && t.position === "finished").length;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingVertical: space.sm,
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        backgroundColor: active ? palette.liftedSlate : "transparent",
        borderWidth: 1,
        borderColor: active ? "transparent" : palette.hairline,
      }}
    >
      {active && <PulseRing color={teamColor[player.color]} />}
      <View
        style={{
          width: 14,
          height: 14,
          borderRadius: radius.pill,
          backgroundColor: teamColor[player.color],
        }}
      />
      <Text
        numberOfLines={1}
        style={{ flexShrink: 1, fontFamily: font.semibold, fontSize: 15, color: active ? palette.porcelain : palette.mutedSteel }}
      >
        {label ?? COLOR_LABEL[player.color]}
      </Text>
      <Text style={{ marginLeft: "auto", fontFamily: font.mono, fontSize: 13, color: palette.mutedSteel }}>
        {finished}/{TOKENS_PER_PLAYER}
      </Text>
    </View>
  );
}

/** The active player's color ring, breathing on a slow perpetual loop. */
function PulseRing({ color }: { color: string }) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 1100 }), -1, true);
    return () => cancelAnimation(pulse);
  }, [pulse]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.45 + pulse.value * 0.55,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          borderRadius: radius.md,
          borderWidth: 1.5,
          borderColor: color,
        },
        style,
      ]}
    />
  );
}
