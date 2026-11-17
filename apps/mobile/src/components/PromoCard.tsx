/**
 * One of our own apps, drawn into a banner slot Google left empty (see
 * lib/ads/promos). Two shapes, matching the slot it stands in for so the screen
 * never moves: a strip the height of the anchored banner on Home, and the
 * medium rectangle in matchmaking.
 */

import { Image, Linking, Pressable, Text, View } from "react-native";
import { useT } from "../i18n";
import { promoUrl, type Promo } from "../lib/ads/promos";
import { PROMO_ICONS } from "../lib/ads/promoIcons";
import { font, palette, radius, space } from "../theme";

interface PromoCardProps {
  promo: Promo;
  /** "strip" fills the anchored banner's height; "rect" is 300x250. */
  shape: "strip" | "rect";
  height: number;
}

export function PromoCard({ promo, shape, height }: PromoCardProps) {
  const t = useT();
  const line = t(promo.line);
  const open = () => {
    Linking.openURL(promoUrl(promo)).catch(() => {});
  };

  if (shape === "rect") {
    return (
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${promo.name}, ${line}`}
        onPress={open}
        style={({ pressed }) => ({
          width: 300,
          height,
          borderRadius: radius.sm,
          backgroundColor: palette.raisedSlate,
          borderWidth: 1,
          borderColor: palette.hairline,
          alignItems: "center",
          justifyContent: "center",
          gap: space.sm,
          paddingHorizontal: space.lg,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Text style={{ fontFamily: font.medium, fontSize: 12, color: palette.mutedSteel }}>{t("promo.fromUs")}</Text>
        <Image source={PROMO_ICONS[promo.id]} style={{ width: 84, height: 84, borderRadius: 19 }} />
        <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 18, color: palette.porcelain }}>
          {promo.name}
        </Text>
        <Text numberOfLines={2} style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel, textAlign: "center" }}>
          {line}
        </Text>
        <GetPill label={t("promo.get")} />
      </Pressable>
    );
  }

  const icon = Math.max(36, Math.min(56, height - 16));
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${promo.name}, ${line}`}
      onPress={open}
      style={({ pressed }) => ({
        width: "100%",
        height,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.lg,
        backgroundColor: palette.raisedSlate,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Image source={PROMO_ICONS[promo.id]} style={{ width: icon, height: icon, borderRadius: Math.round(icon * 0.225) }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 15, color: palette.porcelain }}>
          {promo.name}
        </Text>
        <Text numberOfLines={1} style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>
          {line}
        </Text>
      </View>
      <GetPill label={t("promo.get")} />
    </Pressable>
  );
}

function GetPill({ label }: { label: string }) {
  return (
    <View
      style={{
        minWidth: 64,
        height: 30,
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        backgroundColor: palette.porcelain,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontFamily: font.semibold, fontSize: 14, color: palette.feltCharcoal }}>{label}</Text>
    </View>
  );
}
