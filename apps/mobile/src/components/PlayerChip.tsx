/**
 * A player's profile card shown at a board corner (Ludo King layout): avatar in
 * a team-colored frame, name, and finished-token count. The active player's
 * frame lifts and breathes, with a turn-countdown ring beneath; a dropped online
 * player dims and shows "Away". Avatar falls back to a team-color disc.
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
import { AvatarGlyph } from "./Avatar";
import { depth, font, palette, radius, space, teamColor } from "../theme";

const COLOR_LABEL: Record<PlayerState["color"], string> = {
  red: "Red",
  green: "Green",
  yellow: "Yellow",
  blue: "Blue",
};

const AVATAR = 48;

interface PlayerChipProps {
  player: PlayerState;
  state: GameState;
  active: boolean;
  label?: string;
  avatarId?: string | null;
  offline?: boolean;
  timer?: { seq: number; seconds: number } | null;
  /** Text alignment within the corner (left for left column, right otherwise). */
  align?: "left" | "right";
}

export function PlayerChip({ player, state, active, label, avatarId, offline = false, timer = null, align = "left" }: PlayerChipProps) {
  const color = teamColor[player.color];
  const finished = state.tokens.filter((t) => t.playerId === player.id && t.position === "finished").length;

  return (
    <View style={{ alignItems: "center", width: 92, opacity: offline ? 0.55 : 1 }}>
      <View style={{ width: AVATAR + 14, height: AVATAR + 14, alignItems: "center", justifyContent: "center" }}>
        {active && <Breathe color={color} />}
        <View
          style={{
            width: AVATAR + 8,
            height: AVATAR + 8,
            borderRadius: radius.md,
            backgroundColor: palette.liftedSlate,
            borderWidth: active ? 2.5 : 2,
            borderColor: color,
            borderTopColor: active ? depth.highlight : color,
            alignItems: "center",
            justifyContent: "center",
            ...(active ? depth.shadow : {}),
          }}
        >
          {avatarId ? (
            <AvatarGlyph id={avatarId} size={AVATAR} />
          ) : (
            <View style={{ width: AVATAR, height: AVATAR, borderRadius: radius.sm, backgroundColor: color }} />
          )}
        </View>
      </View>

      {active && timer ? <TurnTimerBar seq={timer.seq} seconds={timer.seconds} color={color} /> : <View style={{ height: 3, marginTop: 3 }} />}

      <Text
        numberOfLines={1}
        style={{
          marginTop: 4,
          maxWidth: 92,
          textAlign: align === "right" ? "right" : "left",
          alignSelf: align === "right" ? "flex-end" : "flex-start",
          fontFamily: font.semibold,
          fontSize: 13,
          color: active ? palette.porcelain : palette.mutedSteel,
        }}
      >
        {offline ? `${label ?? COLOR_LABEL[player.color]} · Away` : label ?? COLOR_LABEL[player.color]}
      </Text>
      <Text
        style={{
          alignSelf: align === "right" ? "flex-end" : "flex-start",
          fontFamily: font.mono,
          fontSize: 11,
          color: palette.mutedSteel,
        }}
      >
        {finished}/{TOKENS_PER_PLAYER} home
      </Text>
    </View>
  );
}

/** A short depleting bar beneath the active avatar, warming to red as time runs out. */
function TurnTimerBar({ seq, seconds, color }: { seq: number; seconds: number; color: string }) {
  const progress = useSharedValue(1);
  useEffect(() => {
    progress.value = 1;
    progress.value = withTiming(0, { duration: seconds * 1000, easing: Easing.linear });
    return () => cancelAnimation(progress);
  }, [seq, seconds, progress]);

  const style = useAnimatedStyle(() => ({
    width: `${Math.max(0, progress.value) * 100}%`,
    backgroundColor: progress.value > 0.35 ? color : teamColor.red,
  }));

  return (
    <View style={{ width: AVATAR + 8, height: 3, marginTop: 3, borderRadius: radius.pill, backgroundColor: palette.hairline, overflow: "hidden" }}>
      <Animated.View style={[{ height: "100%", borderRadius: radius.pill }, style]} />
    </View>
  );
}

/** The active frame's breathing color glow. */
function Breathe({ color }: { color: string }) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 1600 }), -1, true);
    return () => cancelAnimation(pulse);
  }, [pulse]);
  const style = useAnimatedStyle(() => ({ opacity: 0.35 + pulse.value * 0.4 }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, borderRadius: radius.md + 3, borderWidth: 2, borderColor: color },
        style,
      ]}
    />
  );
}
