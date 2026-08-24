/**
 * A plain line in the gem economy — now just the coin exchanges.
 *
 * The packs and the rewarded ad graduated to cards with their own art, because
 * those are the offers a player is choosing BETWEEN and the art does the
 * comparing. An exchange is not an offer, it is a conversion at a fixed rate:
 * three amounts of the same trade, where a row is the honest shape and cards
 * would be three pieces of furniture pretending to be a decision.
 *
 * `dimmed` and `disabled` are deliberately different. Dimmed still takes the
 * tap, because the greyest row here ("None left today") is the one a player is
 * most likely to poke at twice, and a button that swallows the tap explains
 * nothing.
 */

import { Pressable, Text, View } from "react-native";
import { Surface3D } from "./Surface3D";
import { GemGlyph } from "./GemGlyph";
import { CoinGlyph } from "./CoinsPill";
import { font, palette, space } from "../theme";

export function GemRow({
  title,
  subtitle,
  coinYield = false,
  disabled,
  dimmed = false,
  onPress,
}: {
  title: string;
  subtitle: string;
  coinYield?: boolean;
  disabled: boolean;
  dimmed?: boolean;
  onPress: () => void;
}) {
  const grey = disabled || dimmed;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}`}
      accessibilityState={{ disabled: grey }}
      disabled={disabled}
      onPress={onPress}
    >
      {({ pressed }) => (
        <Surface3D
          pressed={pressed && !grey}
          style={{ opacity: grey ? 0.45 : 1 }}
          faceStyle={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: space.lg,
            paddingVertical: space.md,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <GemGlyph size={16} />
            <Text style={{ fontFamily: font.semibold, fontSize: 15, color: palette.porcelain }}>{title}</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            {coinYield ? <CoinGlyph size={13} /> : null}
            <Text style={{ fontFamily: font.mono, fontSize: 13, color: palette.mutedSteel }}>{subtitle}</Text>
          </View>
        </Surface3D>
      )}
    </Pressable>
  );
}
