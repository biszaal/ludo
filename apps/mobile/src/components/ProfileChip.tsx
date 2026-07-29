/**
 * Home header identity: the avatar in a Raised Slate disc (opens Profile) and
 * a drawn gear button (opens Settings). Avatar only — the name lives on the
 * Profile screen; spelling it out here crowded the header off the screen edge.
 * No icon fonts, no emojis.
 */

import { Pressable, View } from "react-native";
import { Canvas, Circle, Group, RoundedRect } from "@shopify/react-native-skia";
import { AvatarGlyph } from "./Avatar";
import { useNav } from "../store/navStore";
import { useProfile } from "../store/profileStore";
import { palette, radius, space } from "../theme";

export function ProfileChip() {
  const displayName = useProfile((s) => s.displayName);
  const avatarId = useProfile((s) => s.avatarId);
  const push = useNav((s) => s.push);

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Profile: ${displayName}`}
        onPress={() => push("profile")}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          borderRadius: radius.pill,
          backgroundColor: palette.raisedSlate,
          borderWidth: 1,
          borderColor: palette.hairline,
          alignItems: "center",
          justifyContent: "center",
          transform: [{ scale: pressed ? 0.96 : 1 }],
        })}
      >
        <AvatarGlyph id={avatarId} size={34} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Settings"
        onPress={() => push("settings")}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          borderRadius: radius.pill,
          backgroundColor: palette.raisedSlate,
          borderWidth: 1,
          borderColor: palette.hairline,
          alignItems: "center",
          justifyContent: "center",
          transform: [{ scale: pressed ? 0.96 : 1 }, { rotate: pressed ? "18deg" : "0deg" }],
        })}
      >
        <GearGlyph size={20} />
      </Pressable>
    </View>
  );
}

function GearGlyph({ size }: { size: number }) {
  const c = size / 2;
  const toothW = size * 0.16;
  const toothH = size * 0.24;
  return (
    <Canvas style={{ width: size, height: size }}>
      {Array.from({ length: 8 }, (_unused, i) => (
        <Group key={i} origin={{ x: c, y: c }} transform={[{ rotate: (Math.PI * i) / 4 }]}>
          <RoundedRect x={c - toothW / 2} y={0} width={toothW} height={toothH} r={toothW * 0.4} color={palette.mutedSteel} />
        </Group>
      ))}
      <Circle cx={c} cy={c} r={size * 0.32} color={palette.mutedSteel} />
      <Circle cx={c} cy={c} r={size * 0.14} color={palette.raisedSlate} />
    </Canvas>
  );
}
