/**
 * The floating speech bubble beside a player's corner chip (Ludo King /
 * Ludo Club style): BOTH reactions and text messages render inside a white
 * bubble whose tail points at the sender's avatar. Reactions show as one big
 * emoji, texts as up to three lines; both pop in with a spring, hold long
 * enough to read, then fade. Top-corner chips bubble downward over the board
 * and bottom-corner chips upward, so a bubble never leaves the screen or
 * covers the top bar. Re-fires whenever `seq` changes; unmounts its content
 * when the run ends so stale bubbles never linger.
 */

import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { resolveEmoji } from "../lib/emoji";
import { font, radius, space } from "../theme";

const EMOJI_MS = 2600;
const TEXT_MS = 3600;

interface ChatBubbleProps {
  value: string;
  kind: "reaction" | "text";
  seq: number;
  /** Which side of the screen the chip sits on — the bubble and its tail hug that side. */
  align: "left" | "right";
  /** Which way the bubble pops: bottom chips bubble up, top chips bubble down. */
  vAlign: "above" | "below";
}

export function ChatBubble({ value, kind, seq, align, vAlign }: ChatBubbleProps) {
  const progress = useSharedValue(0);
  const [visible, setVisible] = useState(false);
  const runMs = kind === "text" ? TEXT_MS : EMOJI_MS;

  useEffect(() => {
    setVisible(true);
    progress.value = 0;
    progress.value = withTiming(1, { duration: runMs, easing: Easing.out(Easing.quad) });
    const t = setTimeout(() => setVisible(false), runMs + 80);
    return () => clearTimeout(t);
  }, [seq, runMs, progress]);

  // Springy pop-in, steady hold, quick fade at the tail end; the bubble
  // nudges away from the avatar so the pop reads as "spoken" by the chip.
  const drift = vAlign === "above" ? -6 : 6;
  const bubbleStyle = useAnimatedStyle(() => ({
    opacity: progress.value < 0.06 ? progress.value / 0.06 : progress.value > 0.88 ? (1 - progress.value) / 0.12 : 1,
    transform: [
      { translateY: drift },
      { scale: 0.6 + Math.min(progress.value * 10, 1) * 0.4 },
    ],
  }));

  if (!visible) return null;

  // Tail: a rotated square peeking out of the bubble's avatar-facing edge.
  const tail = (
    <View
      style={{
        width: 12,
        height: 12,
        ...(vAlign === "above" ? { marginTop: -6 } : {}),
        ...(align === "left" ? { marginLeft: 18 } : { marginRight: 18 }),
        backgroundColor: "#FFFFFF",
        transform: [{ rotate: "45deg" }],
      }}
    />
  );

  const bubble = (
    <View
      style={{
        maxWidth: 170,
        ...(vAlign === "below" ? { marginTop: -6 } : {}),
        backgroundColor: "#FFFFFF",
        borderRadius: radius.md,
        paddingHorizontal: kind === "reaction" ? space.sm : space.md,
        paddingVertical: kind === "reaction" ? space.xs : space.sm,
        shadowColor: "#000",
        shadowOpacity: 0.3,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 8,
      }}
    >
      {kind === "reaction" ? (
        (() => {
          const sprite = resolveEmoji(value);
          return sprite ? (
            <Image source={sprite.source} accessibilityLabel={sprite.label} style={{ width: 40, height: 40 }} />
          ) : (
            <Text style={{ fontSize: 32 }}>{value}</Text>
          );
        })()
      ) : (
        <Text numberOfLines={3} style={{ fontFamily: font.medium, fontSize: 13, color: "#232830" }}>
          {value}
        </Text>
      )}
    </View>
  );

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          ...(vAlign === "above"
            ? { bottom: "100%", marginBottom: 2 }
            : { top: "100%", marginTop: 2 }),
          ...(align === "left" ? { left: 0 } : { right: 0 }),
          alignItems: align === "left" ? "flex-start" : "flex-end",
          zIndex: 10,
        },
        bubbleStyle,
      ]}
    >
      {vAlign === "above" ? (
        <>
          {bubble}
          {tail}
        </>
      ) : (
        <>
          {tail}
          {bubble}
        </>
      )}
    </Animated.View>
  );
}
