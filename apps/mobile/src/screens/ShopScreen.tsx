/**
 * Shop — the one place to buy every cosmetic (avatars, boards, dice).
 *
 * Two bands, in the order a player needs them: how to get gems, then what to
 * spend them on. Header pills open the matching top-up sheets (coins → Get
 * coins, gems → Gems) and show the exact balance inside.
 *
 * There used to be a PREMIUM rail above the browser, showcasing every
 * gem-priced item as a horizontal carousel. It went because it was redundant
 * as well as crowded: every item it showed appears in the browser directly
 * below it, so the top of the screen was spent saying the same thing twice.
 * GemStrip takes that space back for the one thing the browser cannot answer —
 * where gems come from.
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
import { GemStrip } from "../components/GemStrip";
import { CosmeticsBrowser } from "../components/CosmeticsBrowser";
import { GetCoinsSheet } from "../components/GetCoinsSheet";
import { GetGemsSheet } from "../components/GetGemsSheet";
import { palette, space } from "../theme";

export function ShopScreen() {
  const [coinsSheet, setCoinsSheet] = useState(false);
  const [gemsSheet, setGemsSheet] = useState(false);

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
            <GemsPill compact onPress={() => setGemsSheet(true)} />
            <CoinsPill compact onPress={() => setCoinsSheet(true)} />
          </View>
        }
      />

      <ScrollView contentContainerStyle={{ paddingTop: space.lg, paddingBottom: space.xxl + dockPad, alignItems: "center" }}>
        <ContentColumn style={{ paddingHorizontal: space.xl, gap: space.lg }}>
          <GemStrip onOpenGems={() => setGemsSheet(true)} />
          <CosmeticsBrowser mode="shop" />
        </ContentColumn>
      </ScrollView>

      {coinsSheet && <GetCoinsSheet onClose={() => setCoinsSheet(false)} />}
      {gemsSheet && <GetGemsSheet onClose={() => setGemsSheet(false)} />}
    </SafeAreaView>
  );
}
