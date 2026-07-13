/**
 * A player's profile card shown at a board corner (Ludo King layout): avatar in
 * a team-colored frame, name, and finished-token count. The active player's
 * colored frame gives way to a single animated ring — the ticking countdown
 * when a turn timer runs (warming to red as time drains), a slow breathe
 * otherwise — so the avatar never wears two borders at once. A dropped online
 * player dims and shows "Away". When the seat is on autopilot, a BOT badge
 * sits on the avatar and tapping the chip hands control back to the human.
 * Avatar falls back to a team-color disc.
 */

import { useEffect, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { Canvas, Path, Skia } from "@shopify/react-native-skia";
import { TOKENS_PER_PLAYER, type GameState, type PlayerState } from "@ludo/engine";
import { AvatarGlyph } from "./Avatar";
import { depth, font, palette, radius, teamColor } from "../theme";

const COLOR_LABEL: Record<PlayerState["color"], string> = {
  red: "Red",
  green: "Green",
  yellow: "Yellow",
  blue: "Blue",
};

const AVATAR = 48;
const RING_BOX = AVATAR + 14; // outer container; the ring hugs the frame inside it
const RING_STROKE = 3.5;

interface PlayerChipProps {
  player: PlayerState;
  state: GameState;
  active: boolean;
  label?: string;
  avatarId?: string | null;
  offline?: boolean;
  /** The player quit for good — dims the chip and shows "Left" (beats Away). */
  left?: boolean;
  timer?: { seq: number; seconds: number } | null;
  /** Text alignment within the corner (left for left column, right otherwise). */
  align?: "left" | "right";
  /** This seat is on autopilot (local-only) — shows the BOT badge. */
  botMode?: boolean;
  /** Makes the chip tappable (autopilot reclaim). */
  onPress?: (() => void) | null;
}

export function PlayerChip({
  player,
  state,
  active,
  label,
  avatarId,
  offline = false,
  left = false,
  timer = null,
  align = "left",
  botMode = false,
  onPress = null,
}: PlayerChipProps) {
  const color = teamColor[player.color];
  const finished = state.tokens.filter((t) => t.playerId === player.id && t.position === "finished").length;

  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={onPress ? "Bot is playing for you — tap to take back control" : undefined}
      disabled={!onPress}
      onPress={onPress ?? undefined}
      style={({ pressed }) => ({
        alignItems: "center",
        width: 92,
        opacity: left ? 0.4 : offline ? 0.55 : 1,
        transform: [{ scale: pressed ? 0.93 : 1 }],
      })}
    >
      <View style={{ width: RING_BOX, height: RING_BOX, alignItems: "center", justifyContent: "center" }}>
        {active && !timer && <Breathe color={color} />}
        <View
          style={{
            width: AVATAR + 8,
            height: AVATAR + 8,
            borderRadius: radius.md,
            backgroundColor: palette.liftedSlate,
            // Active: the animated ring (countdown or breathe) IS the border —
            // a second colored frame underneath read as a double border.
            borderWidth: active ? 2.5 : 2,
            borderColor: active ? "transparent" : color,
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
        {active && timer ? <TurnRing seq={timer.seq} seconds={timer.seconds} color={color} /> : null}
        {botMode ? <BotBadge /> : null}
      </View>

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
        {left
          ? `${label ?? COLOR_LABEL[player.color]} · Left`
          : offline
            ? `${label ?? COLOR_LABEL[player.color]} · Away`
            : label ?? COLOR_LABEL[player.color]}
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
    </Pressable>
  );
}

/** "BOT" pill on the avatar while autopilot plays this seat (local-only). */
function BotBadge() {
  return (
    <View
      style={{
        position: "absolute",
        bottom: -5,
        alignSelf: "center",
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: radius.pill,
        backgroundColor: palette.porcelain,
        zIndex: 2,
      }}
    >
      <Text style={{ fontFamily: font.semibold, fontSize: 9, letterSpacing: 0.8, color: palette.feltCharcoal }}>BOT</Text>
    </View>
  );
}

/**
 * The countdown ring: a rounded-rect stroke tracing the avatar frame's edge.
 * The path is trimmed by an animated `end`, so the ring visibly recedes in one
 * direction (from the path start, clockwise) as the turn's time drains.
 */
function TurnRing({ seq, seconds, color }: { seq: number; seconds: number; color: string }) {
  const progress = useSharedValue(1);

  useEffect(() => {
    progress.value = 1;
    progress.value = withTiming(0, { duration: seconds * 1000, easing: Easing.linear });
    return () => cancelAnimation(progress);
  }, [seq, seconds, progress]);

  const end = useDerivedValue(() => Math.max(0, Math.min(1, progress.value)));
  const ringColor = useDerivedValue(() => (progress.value > 0.3 ? color : teamColor.red));

  const path = useMemo(() => {
    const inset = RING_STROKE / 2 + 0.5;
    const p = Skia.Path.Make();
    p.addRRect(
      Skia.RRectXY(
        Skia.XYWHRect(inset, inset, RING_BOX - inset * 2, RING_BOX - inset * 2),
        radius.md + 1,
        radius.md + 1,
      ),
    );
    return p;
  }, []);

  return (
    <Canvas pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width: RING_BOX, height: RING_BOX }}>
      <Path path={path} style="stroke" strokeWidth={RING_STROKE} strokeCap="round" color={ringColor} start={0} end={end} />
    </Canvas>
  );
}

/** The active frame's breathing color glow (shown when no timer ring runs). */
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
