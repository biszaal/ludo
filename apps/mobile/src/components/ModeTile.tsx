/**
 * A small square-ish mode tile for the hub's three-across row. Terse by
 * design: a drawn glyph over a one-word-ish label — the PlaySetupSheet
 * carries the details once tapped.
 */

import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Surface3D } from "./Surface3D";
import { useLayout } from "../lib/useLayout";
import { font, palette, radius, space } from "../theme";

export function ModeTile({ label, glyph, onPress }: { label: string; glyph: ReactNode; onPress: () => void }) {
  const { scale } = useLayout();
  const height = Math.round(96 * scale);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ flex: 1 }}>
      {({ pressed }) => (
        <Surface3D rad={radius.lg} pressed={pressed} faceStyle={{ height: height - 3, alignItems: "center", justifyContent: "center", gap: space.sm }}>
          <View style={{ height: Math.round(32 * scale), alignItems: "center", justifyContent: "center" }}>{glyph}</View>
          <Text style={{ fontFamily: font.semibold, fontSize: Math.round(13 * scale), color: palette.porcelain }}>{label}</Text>
        </Surface3D>
      )}
    </Pressable>
  );
}
