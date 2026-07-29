/**
 * Shop — the one place to buy every cosmetic (avatars, boards, dice). The
 * PREMIUM rail up top showcases the gem tier; the browser below carries the
 * full coin catalog. Header pills open the matching top-up sheets (coins →
 * Get coins, gems → Gems) — and show the exact balance inside.
 */

import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TableBackground } from "../components/TableBackground";
import { ScreenHeader } from "../components/ScreenHeader";
import { ContentColumn } from "../components/ContentColumn";
import { SectionLabel } from "../components/SectionLabel";
import { Surface3D } from "../components/Surface3D";
import { Canvas, Group } from "@shopify/react-native-skia";
import { CoinsPill } from "../components/CoinsPill";
import { GemsPill } from "../components/GemsPill";
import { GemGlyph } from "../components/GemGlyph";
import { AvatarGlyph } from "../components/Avatar";
import { BoardSurface } from "../components/Board";
import { DieStill, stillDieColors } from "../components/DieStill";
import { CosmeticsBrowser } from "../components/CosmeticsBrowser";
import { GetCoinsSheet } from "../components/GetCoinsSheet";
import { GetGemsSheet } from "../components/GetGemsSheet";
import { PriceTag } from "../components/PriceTag";
import { cosmeticItems, type CosmeticCategory, type CosmeticItem } from "../lib/cosmetics";
import { BOARD_THEMES, type BoardThemeId } from "../render/boardThemes";
import { DICE_SKINS, type DiceSkinId } from "../render/diceSkins";
import { currencyOf, isUnlocked, priceOf, useEntitlements } from "../store/entitlementsStore";
import { useCosmeticsUI } from "../store/cosmeticsUI";
import { useSettings } from "../store/settingsStore";
import { font, palette, radius, space } from "../theme";

export function ShopScreen() {
  const [coinsSheet, setCoinsSheet] = useState(false);
  const [gemsSheet, setGemsSheet] = useState(false);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.tableBlue }}>
      <TableBackground />
      <ScreenHeader
        title="Shop"
        right={
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <GemsPill compact onPress={() => setGemsSheet(true)} />
            <CoinsPill compact onPress={() => setCoinsSheet(true)} />
          </View>
        }
      />

      <ScrollView contentContainerStyle={{ paddingTop: space.lg, paddingBottom: space.xxl, alignItems: "center" }}>
        <ContentColumn style={{ paddingHorizontal: space.xl, gap: space.lg }}>
          <PremiumRail />
          <CosmeticsBrowser mode="shop" />
        </ContentColumn>
      </ScrollView>

      {coinsSheet && <GetCoinsSheet onClose={() => setCoinsSheet(false)} />}
      {gemsSheet && <GetGemsSheet onClose={() => setGemsSheet(false)} />}
    </SafeAreaView>
  );
}

/** The gem tier, up front: every gem-priced catalog item as a horizontal rail
 *  of showcase cards. Tapping one flips the browser below to its category —
 *  the buy flow itself stays in one place (the browser's grid + BuySheet). */
function PremiumRail() {
  const currencies = useEntitlements((s) => s.currencies);
  const prices = useEntitlements((s) => s.prices);
  const owned = useEntitlements((s) => s.owned);
  const setCategory = useCosmeticsUI((s) => s.setCategory);
  const boardTheme = BOARD_THEMES[useSettings((s) => s.boardThemeId)];

  const premium: { category: CosmeticCategory; item: CosmeticItem }[] = (
    ["dice", "board", "avatar"] as CosmeticCategory[]
  ).flatMap((category) =>
    cosmeticItems(category)
      .filter((it) => currencyOf(currencies, it.sku) === "gems")
      .map((item) => ({ category, item })),
  );
  if (premium.length === 0) return null;

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <GemGlyph size={14} />
        <SectionLabel>Premium</SectionLabel>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {premium.map(({ category, item }) => {
          const unlocked = isUnlocked(owned, prices, item.sku);
          return (
            <Pressable
              key={item.sku}
              accessibilityRole="button"
              accessibilityLabel={`${item.label}, premium ${category}`}
              onPress={() => setCategory(category)}
            >
              {({ pressed }) => (
                <Surface3D pressed={pressed} faceColor={palette.liftedSlate} rad={radius.lg} faceStyle={{ width: 116, alignItems: "center", paddingVertical: space.md, gap: space.sm }}>
                  <View style={{ height: 72, justifyContent: "center" }}>
                    {category === "avatar" ? (
                      <AvatarGlyph id={item.id} size={64} />
                    ) : category === "board" ? (
                      <Canvas style={{ width: 64, height: 64 }}>
                        <BoardSurface size={64} theme={BOARD_THEMES[item.id as BoardThemeId]} />
                      </Canvas>
                    ) : (
                      <Canvas style={{ width: 64, height: 72 }}>
                        <Group transform={[{ translateX: 32 }, { translateY: 32 }]}>
                          <DieStill size={44} {...stillDieColors(DICE_SKINS[item.id as DiceSkinId], boardTheme)} />
                        </Group>
                      </Canvas>
                    )}
                  </View>
                  <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 13, color: palette.porcelain, textTransform: "capitalize" }}>
                    {item.label}
                  </Text>
                  {unlocked ? (
                    <Text style={{ fontFamily: font.regular, fontSize: 11, color: palette.mutedSteel }}>Owned</Text>
                  ) : (
                    <PriceTag price={priceOf(prices, item.sku)} currency="gems" />
                  )}
                </Surface3D>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
