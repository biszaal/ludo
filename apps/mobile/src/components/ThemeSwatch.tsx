/**
 * A selectable board-skin tile: live BoardSurface thumbnail + a dice chip in
 * the theme's face/pip colors + label. Selection ring is Porcelain (neutral).
 */

import { Pressable, Text, View } from "react-native";
import { Canvas } from "@shopify/react-native-skia";
import { BoardSurface } from "./Board";
import type { BoardTheme } from "../render/boardThemes";
import { font, palette, radius, space } from "../theme";

const THUMB = 72;

interface ThemeSwatchProps {
  theme: BoardTheme;
  selected: boolean;
  onSelect: () => void;
}

export function ThemeSwatch({ theme, selected, onSelect }: ThemeSwatchProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${theme.label} board`}
      onPress={onSelect}
      style={({ pressed }) => ({
        alignItems: "center",
        gap: space.sm,
        padding: space.sm,
        borderRadius: radius.md,
        borderWidth: 1.5,
        borderColor: selected ? palette.porcelain : "transparent",
        backgroundColor: selected ? palette.raisedSlate : "transparent",
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <View style={{ width: THUMB, height: THUMB, borderRadius: 8, overflow: "hidden" }}>
        <Canvas style={{ width: THUMB, height: THUMB }}>
          <BoardSurface size={THUMB} theme={theme} />
        </Canvas>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View
          style={{
            width: 14,
            height: 14,
            borderRadius: 4,
            backgroundColor: theme.dice.face,
            borderWidth: 1,
            borderColor: palette.hairline,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: theme.dice.pip }} />
        </View>
        <Text style={{ fontFamily: font.medium, fontSize: 13, color: selected ? palette.porcelain : palette.mutedSteel }}>
          {theme.label}
        </Text>
      </View>
    </Pressable>
  );
}
