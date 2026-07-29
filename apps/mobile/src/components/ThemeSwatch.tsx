/**
 * A selectable board-skin tile: live BoardSurface thumbnail + a dice chip in
 * the theme's face/pip colors + label. Selection ring is Porcelain (neutral).
 */

import { Pressable, Text, View } from "react-native";
import { Canvas } from "@shopify/react-native-skia";
import { BoardSurface } from "./Board";
import { PriceTag, type PriceCurrency } from "./PriceTag";
import type { BoardTheme } from "../render/boardThemes";
import { font, palette, radius, space } from "../theme";

// Fits the ~72px cell that a 4-up ("22%") grid yields on a 375pt screen —
// the board thumbnail has no internal padding, so it runs a touch smaller than
// the dice swatch's 72 to leave room for the tile's own padding + ring.
const THUMB = 64;

interface ThemeSwatchProps {
  theme: BoardTheme;
  selected: boolean;
  /** Coins to unlock; 0 (or owned) means selectable. */
  price?: number;
  /** Which wallet the price charges (display only). */
  currency?: PriceCurrency;
  locked?: boolean;
  onSelect: () => void;
}

export function ThemeSwatch({ theme, selected, price = 0, currency = "coins", locked = false, onSelect }: ThemeSwatchProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={locked ? `${theme.label} board, locked, ${price} ${currency}` : `${theme.label} board`}
      onPress={onSelect}
      style={({ pressed }) => ({
        width: "22%",
        alignItems: "center",
        gap: space.sm,
        padding: space.xs,
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
        {/* Dim the preview but never hide it — seeing what you'd get is the
            whole reason to want it. */}
        {locked ? (
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(20,23,28,0.45)",
            }}
          >
            <PriceTag price={price} currency={currency} />
          </View>
        ) : null}
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
