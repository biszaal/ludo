/**
 * The emoji strip that opens from the bottom-left action cluster (online
 * play). One tap sends the reaction to the room and closes the strip; the
 * backdrop closes it without sending.
 */

import { Pressable, Text, View } from "react-native";
import Animated, { Easing, FadeIn, FadeOut } from "react-native-reanimated";
import { Surface3D } from "./Surface3D";
import { playSound } from "../lib/sound";
import { tapLight } from "../lib/haptics";
import { radius, space } from "../theme";

export const REACTIONS = ["😂", "😭", "👍", "🔥", "😡", "🎉"] as const;

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
        style={{ position: "absolute", bottom: 108, left: space.xl }}
      >
        <Surface3D rad={radius.pill} edge={3} faceStyle={{ flexDirection: "row", paddingHorizontal: space.sm, paddingVertical: space.xs }}>
          {REACTIONS.map((emoji) => (
            <Pressable
              key={emoji}
              accessibilityRole="button"
              accessibilityLabel={`React ${emoji}`}
              onPress={() => {
                playSound("tap");
                tapLight();
                onSend(emoji);
                onClose();
              }}
              style={({ pressed }) => ({
                paddingHorizontal: 7,
                paddingVertical: 6,
                transform: [{ scale: pressed ? 1.2 : 1 }],
              })}
            >
              <Text style={{ fontSize: 26 }}>{emoji}</Text>
            </Pressable>
          ))}
        </Surface3D>
      </Animated.View>
    </View>
  );
}
