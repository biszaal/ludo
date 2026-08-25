/**
 * A selectable dice-skin tile: the die as a small 3D cube (DieCube), plus
 * label and price. The tile chrome around it — selection border, raised-slate
 * fill, PriceTag — is unchanged and shared with ThemeSwatch.tsx.
 *
 * The die itself deliberately lives in DieCube.tsx rather than here: the
 * Premium rail on the Shop screen shows the same skins, and when the two
 * surfaces drew their own previews they disagreed about what a skin looks
 * like. See that file for why it is a cube and not the flat face this tile
 * used to draw.
 */

import { memo } from "react";
import { Pressable, Text, View } from "react-native";
import { DieCube } from "./DieCube";
import { PriceTag, type PriceCurrency } from "./PriceTag";
import type { BoardTheme } from "../render/boardThemes";
import type { DiceSkin } from "../render/diceSkins";
import { font, palette, radius, space } from "../theme";

const THUMB = 72;

interface DiceSwatchProps {
  skin: DiceSkin;
  /** Kept for signature compatibility with the themed swatches beside it; the
   *  die itself no longer reads it (see DEFAULT_DIE). */
  theme?: BoardTheme;
  selected: boolean;
  /** Coins to unlock; 0 (or owned) means selectable. */
  price?: number;
  /** Which wallet the price charges (display only). */
  currency?: PriceCurrency;
  locked?: boolean;
  onSelect: () => void;
}

/**
 * Memoized: the shop renders these in an unvirtualized ScrollView, so all of
 * them stay mounted, and every one carries its own Skia canvas. A store write
 * anywhere (a wallet refresh, an entitlement landing) re-rendered the lot.
 */
export const DiceSwatch = memo(function DiceSwatch({ skin, selected, price = 0, currency = "coins", locked = false, onSelect }: DiceSwatchProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={locked ? `${skin.label} dice, locked, ${price} ${currency}` : `${skin.label} dice`}
      onPress={onSelect}
      style={({ pressed }) => ({
        width: "22%",
        alignItems: "center",
        padding: space.xs,
        borderRadius: radius.md,
        borderWidth: 1.5,
        borderColor: selected ? palette.porcelain : "transparent",
        backgroundColor: selected ? palette.raisedSlate : "transparent",
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      <View>
        <View style={{ width: THUMB, height: THUMB, opacity: locked ? 0.4 : 1 }}>
          <DieCube skin={skin} size={THUMB} />
        </View>
        {locked ? (
          <View style={{ position: "absolute", left: 0, right: 0, bottom: -6, alignItems: "center" }}>
            <PriceTag price={price} currency={currency} />
          </View>
        ) : null}
      </View>
      <Text
        numberOfLines={1}
        style={{
          marginTop: space.xs,
          fontFamily: font.medium,
          fontSize: 12,
          color: selected ? palette.porcelain : palette.mutedSteel,
        }}
      >
        {skin.label}
      </Text>
    </Pressable>
  );
});
