/**
 * Profile — the look you're wearing and the Customize locker: equip the
 * avatars, boards and dice you already own, across one set of tabs with a live
 * preview. "Shop for more" (inside the browser) bridges to the store.
 *
 * Identity + account (name editing, save/sign-in, delete) and stats live on the
 * Account screen (Home dock); this screen owns your LOOK.
 */

import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TableBackground } from "../components/TableBackground";
import { ScreenHeader } from "../components/ScreenHeader";
import { ContentColumn } from "../components/ContentColumn";
import { SectionLabel } from "../components/SectionLabel";
import { Surface3D } from "../components/Surface3D";
import { AvatarGlyph } from "../components/Avatar";
import { CoinsPill } from "../components/CoinsPill";
import { GemsPill } from "../components/GemsPill";
import { CosmeticsBrowser } from "../components/CosmeticsBrowser";
import { useProfile } from "../store/profileStore";
import { font, palette, radius, space } from "../theme";
import { useT } from "../i18n";

export function ProfileScreen() {
  const t = useT();
  const displayName = useProfile((s) => s.displayName);
  const avatarId = useProfile((s) => s.avatarId);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.tableBlue }}>
      <TableBackground />
      <ScreenHeader
        title={t("friends.profile")}
        right={
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <GemsPill compact />
            <CoinsPill compact />
          </View>
        }
      />

      {/* Not a ScrollView any more — see ShopScreen. The identity card and the
          section heading stay put; the browser pins its own preview and
          scrolls the collection grid under it. */}
      <ContentColumn style={{ flex: 1, paddingTop: space.lg, paddingHorizontal: space.xl, gap: space.xl }}>
          {/* Identity preview (edit your name on the Account screen) */}
          <Surface3D rad={radius.lg} faceStyle={{ padding: space.lg }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
              <AvatarGlyph id={avatarId} size={72} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontFamily: font.display, fontSize: 20, color: palette.porcelain }}>{displayName}</Text>
                <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
                  Your look — shown to everyone at the table.
                </Text>
              </View>
            </View>
          </Surface3D>

          {/* Customize: equip the avatars, boards and dice you own. */}
          <View style={{ flex: 1, gap: space.sm }}>
            <SectionLabel>{t("account.customize")}</SectionLabel>
            <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel, marginTop: -4 }}>
              Your collection. Dice show to everyone at the table when you roll.
            </Text>
            <CosmeticsBrowser mode="locker" bottomInset={space.xxl} />
          </View>
      </ContentColumn>
    </SafeAreaView>
  );
}
