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

export function ModeTile({
  label,
  glyph,
  onPress,
  height,
}: {
  label: string;
  glyph: ReactNode;
  onPress: () => void;
  /** Height from the hub's budget; natural size when unset. */
  height?: number;
}) {
  const { scale } = useLayout();
  const natural = Math.round(96 * scale);
  const h = height ?? natural;
  // Glyph well and label ride the tile so a compressed row stays legible
  // rather than letting fixed-size art crowd out the word beneath it.
  const k = h / natural;
  const well = Math.round(Math.max(20, 32 * scale * k));
  const lbl = Math.round(Math.max(11, Math.min(17, 13 * scale * k)));
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ flex: 1 }}>
      {({ pressed }) => (
        <Surface3D
          rad={radius.lg}
          pressed={pressed}
          faceStyle={{ height: h - 3, alignItems: "center", justifyContent: "center", gap: Math.round(space.sm * k) }}
        >
          <View style={{ height: well, alignItems: "center", justifyContent: "center" }}>{glyph}</View>
          <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: lbl, color: palette.porcelain }}>
            {label}
          </Text>
        </Surface3D>
      )}
    </Pressable>
  );
}
