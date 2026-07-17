/**
 * The emoji strip that opens from the bottom-left action cluster. One tap
 * sends the reaction (its ID goes over the wire; see lib/emoji.ts) and closes
 * the strip; the backdrop closes it without sending. Sprites are our own
 * generated set — no unicode emoji.
 */

import { Image, Pressable, View } from "react-native";
import Animated, { Easing, FadeIn, FadeOut } from "react-native-reanimated";
import { Surface3D } from "./Surface3D";
import { EMOJIS } from "../lib/emoji";
import { playSound } from "../lib/sound";
import { tapLight } from "../lib/haptics";
import { radius, space } from "../theme";

interface ReactionBarProps {
  onSend: (value: string) => void;
  onClose: () => void;
}

export function ReactionBar({ onSend, onClose }: ReactionBarProps) {
  return (
    <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 20 }}>
      <Pressable accessibilityLabel="Close reactions" style={{ flex: 1 }} onPress={onClose} />
      <Animated.View
        entering={FadeIn.duration(140).easing(Easing.out(Easing.cubic))}
        exiting={FadeOut.duration(120)}
        // Just above the bottom-left cluster (44px buttons + status block).
        style={{ position: "absolute", bottom: 108, left: space.xl, right: space.xl }}
      >
        <Surface3D
          rad={radius.lg}
          edge={3}
          faceStyle={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", paddingHorizontal: space.sm, paddingVertical: space.xs }}
        >
          {EMOJIS.map((emoji) => (
            <Pressable
              key={emoji.id}
              accessibilityRole="button"
              accessibilityLabel={`React: ${emoji.label}`}
              onPress={() => {
                playSound("tap");
                tapLight();
                onSend(emoji.id);
                onClose();
              }}
              style={({ pressed }) => ({
                paddingHorizontal: 7,
                paddingVertical: 6,
                transform: [{ scale: pressed ? 1.2 : 1 }],
              })}
            >
              <Image source={emoji.source} style={{ width: 34, height: 34 }} />
            </Pressable>
          ))}
        </Surface3D>
      </Animated.View>
    </View>
  );
}
