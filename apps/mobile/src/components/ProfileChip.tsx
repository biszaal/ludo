/**
 * Home header identity: avatar + first name in a Raised Slate pill (opens
 * Profile), and a drawn gear button (opens Settings). No icon fonts, no emojis.
 */

import { Pressable, Text, View } from "react-native";
import { Canvas, Circle, Group, RoundedRect } from "@shopify/react-native-skia";
import { AvatarGlyph } from "./Avatar";
import { useNav } from "../store/navStore";
import { useProfile } from "../store/profileStore";
import { font, palette, radius, space } from "../theme";

export function ProfileChip() {
  const displayName = useProfile((s) => s.displayName);
  const avatarId = useProfile((s) => s.avatarId);
  const push = useNav((s) => s.push);
  const firstName = displayName.split(/\s+/)[0]!;

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Profile: ${displayName}`}
        onPress={() => push("profile")}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingLeft: 6,
          paddingRight: space.md,
          height: 44,
          borderRadius: radius.pill,
          backgroundColor: palette.raisedSlate,
          borderWidth: 1,
          borderColor: palette.hairline,
          transform: [{ scale: pressed ? 0.96 : 1 }],
        })}
      >
        <AvatarGlyph id={avatarId} size={32} />
        <Text style={{ fontFamily: font.semibold, fontSize: 14, color: palette.porcelain }} numberOfLines={1}>
          {firstName}
        </Text>
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
