/**
 * A selectable avatar tile — the drawn chip plus a price chip when locked.
 * Mirrors DiceSwatch/ThemeSwatch so the three cosmetic grids read the same.
 */

import { Pressable, View } from "react-native";
import { AvatarGlyph } from "./Avatar";
import { PriceTag, type PriceCurrency } from "./PriceTag";
import { palette, radius, space } from "../theme";

interface AvatarSwatchProps {
  id: string;
  selected: boolean;
  /** Coins to unlock; 0 (or owned) means selectable. */
  price?: number;
  /** Which wallet the price charges (display only). */
  currency?: PriceCurrency;
  locked?: boolean;
  onSelect: () => void;
}

export function AvatarSwatch({ id, selected, price = 0, currency = "coins", locked = false, onSelect }: AvatarSwatchProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={locked ? `Avatar ${id}, locked, ${price} ${currency}` : `Avatar ${id}`}
      onPress={onSelect}
      style={({ pressed }) => ({
        width: "22%",
        alignItems: "center",
        padding: space.xs,
        borderRadius: radius.md,
        borderWidth: 1.5,
        borderColor: selected ? palette.porcelain : "transparent",
        backgroundColor: selected ? palette.raisedSlate : "transparent",
        transform: [{ scale: pressed ? 0.94 : 1 }],
      })}
    >
      <View>
        <View style={{ opacity: locked ? 0.4 : 1 }}>
          <AvatarGlyph id={id} size={56} />
        </View>
        {locked ? (
          <View style={{ position: "absolute", left: 0, right: 0, bottom: -6, alignItems: "center" }}>
            <PriceTag price={price} currency={currency} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
