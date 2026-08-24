/**
 * Shop — the one place to buy every cosmetic (avatars, boards, dice).
 *
 * The coins pill opens the Get coins sheet; the gems pill goes to the Gems
 * tab, which is where gems live now.
 *
 * There used to be a PREMIUM rail above the browser, showcasing every
 * gem-priced item as a horizontal carousel. It went because it was redundant
 * as well as crowded: every item it showed appears in the browser directly
 * below it, so the top of the screen was spent saying the same thing twice.
 *
 * Where gems come from is the browser's fourth tab now, next to the three
 * cosmetic kinds — one destination every gem pill in the app leads to.
 */

import { useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TableBackground } from "../components/TableBackground";
import { ScreenHeader } from "../components/ScreenHeader";
import { useDockClearance } from "../components/TabDock";
import { ContentColumn } from "../components/ContentColumn";
import { CoinsPill } from "../components/CoinsPill";
import { GemsPill } from "../components/GemsPill";
import { CosmeticsBrowser } from "../components/CosmeticsBrowser";
import { GetCoinsSheet } from "../components/GetCoinsSheet";
import { palette, space } from "../theme";

export function ShopScreen() {
  const [coinsSheet, setCoinsSheet] = useState(false);

  const dockPad = useDockClearance();

  // No bottom edge: the dock floats over this screen and pays that inset
  // itself. The scroll content buys its own room back with dockClearance.
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: palette.tableBlue }}>
      <TableBackground />
      <ScreenHeader
        title="Shop"
        right={
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <GemsPill compact />
            <CoinsPill compact onPress={() => setCoinsSheet(true)} />
          </View>
        }
      />

      <ScrollView contentContainerStyle={{ paddingTop: space.lg, paddingBottom: space.xxl + dockPad, alignItems: "center" }}>
        <ContentColumn style={{ paddingHorizontal: space.xl, gap: space.lg }}>
          <CosmeticsBrowser mode="shop" />
        </ContentColumn>
      </ScrollView>

      {coinsSheet && <GetCoinsSheet onClose={() => setCoinsSheet(false)} />}
    </SafeAreaView>
  );
}
