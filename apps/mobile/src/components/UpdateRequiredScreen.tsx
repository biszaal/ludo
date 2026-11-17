/**
 * "Please update" — a server-driven stop, drawn over the whole app.
 *
 * Mounted only once a config read has succeeded and this build is below the
 * floor (hard) or the recommended version (dismissible). A failed read never
 * mounts it. Not a navigation screen: there is nothing to go back to, and the
 * Android back button is swallowed while the hard stop is up.
 *
 * The store link uses React Native's Linking, which the 1.3.0 binary already
 * has. No new native module.
 */

import { useEffect, useState } from "react";
import { BackHandler, Linking, Platform, Pressable, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "./Button";
import { ContentColumn } from "./ContentColumn";
import { TableBackground } from "./TableBackground";
import { AppVersionGate } from "../lib/appVersionGate";
import { useConfig } from "../store/configStore";
import { font, palette, space } from "../theme";
import { useT } from "../i18n";

export function UpdateRequiredScreen() {
  const t = useT();
  const required = useConfig((s) => s.updateRequired);
  const dismiss = useConfig((s) => s.dismissUpdateSuggestion);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (useConfig.getState().updateRequired) return true;
      useConfig.getState().dismissUpdateSuggestion();
      return true;
    });
    return () => sub.remove();
  }, []);

  const openStore = () => {
    const url = AppVersionGate.storeUrl(Platform.OS);
    if (!url) {
      setFailed(true);
      return;
    }
    setFailed(false);
    Linking.openURL(url).catch(() => setFailed(true));
  };

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      accessibilityViewIsModal
      style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: palette.tableBlue, zIndex: 50 }}
    >
      <TableBackground />
      <SafeAreaView style={{ flex: 1 }}>
        <ContentColumn style={{ flex: 1, justifyContent: "center", paddingHorizontal: space.xl, gap: space.lg }}>
          <View style={{ gap: space.sm }}>
            <Text style={{ fontFamily: font.display, fontSize: 30, color: palette.porcelain }}>
              {required ? t("update.title") : t("update.recommendedTitle")}
            </Text>
            <Text style={{ fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: palette.mutedSteel }}>
              {required ? t("update.body") : t("update.recommendedBody")}
            </Text>
          </View>
          <Button label={t("update.button")} onPress={openStore} />
          {failed ? (
            <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.porcelain }}>
              {t("common.somethingWentWrong")}
            </Text>
          ) : null}
          {required ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("common.maybeLater")}
              onPress={dismiss}
              style={({ pressed }) => ({ alignSelf: "center", opacity: pressed ? 0.7 : 1, paddingVertical: space.sm })}
            >
              <Text style={{ fontFamily: font.semibold, fontSize: 14, color: palette.mutedSteel }}>{t("common.maybeLater")}</Text>
            </Pressable>
          )}
        </ContentColumn>
      </SafeAreaView>
    </Animated.View>
  );
}
