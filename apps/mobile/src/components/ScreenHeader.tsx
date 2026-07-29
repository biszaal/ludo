/**
 * Shared secondary-screen header: title left, optional pills on the right,
 * and a drawn back chevron — replaces six copy-pasted header rows. Back sits
 * rightmost so the pills group with it like the Home header's chip cluster.
 */

import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Canvas, Path } from "@shopify/react-native-skia";
import { ContentColumn } from "./ContentColumn";
import { useNav } from "../store/navStore";
import { playSound } from "../lib/sound";
import { tapLight } from "../lib/haptics";
import { font, palette, radius, space } from "../theme";

export function ScreenHeader({ title, right }: { title: string; right?: ReactNode }) {
  const pop = useNav((s) => s.pop);
  return (
    <ContentColumn
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingHorizontal: space.xl,
        paddingTop: space.sm,
      }}
    >
      <Text style={{ fontFamily: font.display, fontSize: 22, color: palette.porcelain }}>{title}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        {right}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={pop}
          onPressIn={() => {
            playSound("tap");
            tapLight();
          }}
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
          <BackChevron size={16} />
        </Pressable>
      </View>
    </ContentColumn>
  );
}

/** Drawn left-pointing chevron (no text glyphs in chrome). */
function BackChevron({ size }: { size: number }) {
  const s = size;
  return (
    <Canvas style={{ width: s, height: s }}>
      <Path
        path={`M ${s * 0.65} ${s * 0.1} L ${s * 0.25} ${s * 0.5} L ${s * 0.65} ${s * 0.9}`}
        color={palette.porcelain}
        style="stroke"
        strokeWidth={s * 0.16}
        strokeCap="round"
        strokeJoin="round"
      />
    </Canvas>
  );
}
