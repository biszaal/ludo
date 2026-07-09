/**
 * Compact player status row. The active player's panel lifts and breathes — a
 * slow perpetual pulse of its color ring (DESIGN.md §6); inactive panels
 * recede. Finished-token count is mono.
 */

import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { TOKENS_PER_PLAYER, type GameState, type PlayerState } from "@ludo/engine";
import { depth, font, palette, radius, space, teamColor } from "../theme";

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
  /** Online: the seat's player has dropped (dims the row, shows a badge). */
  offline?: boolean;
  /** Online: countdown for the active turn. `seq` re-keys the depletion. */
  timer?: { seq: number; seconds: number } | null;
}

export function PlayerPanel({ player, state, active, label, offline = false, timer = null }: PlayerPanelProps) {
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
        // The active panel lifts off the felt; inactive panels stay flush.
        borderTopColor: active ? depth.highlight : palette.hairline,
        ...(active ? depth.shadow : {}),
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
      {offline ? <OfflineBadge /> : null}
      <Text style={{ marginLeft: "auto", fontFamily: font.mono, fontSize: 13, color: palette.mutedSteel }}>
        {finished}/{TOKENS_PER_PLAYER}
      </Text>
      {active && timer ? <TurnTimerBar seq={timer.seq} seconds={timer.seconds} color={teamColor[player.color]} /> : null}
    </View>
  );
}

/** A thin bar under the active panel that depletes over the turn's time limit. */
function TurnTimerBar({ seq, seconds, color }: { seq: number; seconds: number; color: string }) {
  const progress = useSharedValue(1);

  useEffect(() => {
    progress.value = 1;
    progress.value = withTiming(0, { duration: seconds * 1000, easing: Easing.linear });
    return () => cancelAnimation(progress);
  }, [seq, seconds, progress]);

  const style = useAnimatedStyle(() => ({
    width: `${Math.max(0, progress.value) * 100}%`,
    // Warm to red as time runs low.
    backgroundColor: progress.value > 0.35 ? color : teamColor.red,
    opacity: 0.5 + Math.min(progress.value, 0.35) * (0.5 / 0.35),
  }));

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: space.sm,
        right: space.sm,
        bottom: 3,
        height: 2.5,
        borderRadius: radius.pill,
        backgroundColor: palette.hairline,
        overflow: "hidden",
      }}
    >
      {/* Pinned to the left so the fill only recedes from the right (one way). */}
      <Animated.View style={[{ position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: radius.pill }, style]} />
    </View>
  );
}

/** A small "away" chip when an online player has dropped. */
function OfflineBadge() {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: space.sm,
        paddingVertical: 2,
        borderRadius: radius.pill,
        backgroundColor: palette.raisedSlate,
        borderWidth: 1,
        borderColor: palette.hairline,
      }}
    >
      <View style={{ width: 6, height: 6, borderRadius: radius.pill, backgroundColor: palette.mutedSteel }} />
      <Text style={{ fontFamily: font.medium, fontSize: 11, color: palette.mutedSteel }}>Away</Text>
    </View>
  );
}

/** The active player's color ring, breathing on a slow perpetual loop. */
function PulseRing({ color }: { color: string }) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 1600 }), -1, true);
    return () => cancelAnimation(pulse);
  }, [pulse]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.7 + pulse.value * 0.3,
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
