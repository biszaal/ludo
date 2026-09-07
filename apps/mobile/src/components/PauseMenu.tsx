/**
 * In-game pause sheet: quick sound/music/haptics toggles, How to play, and
 * Leave. The game stays live behind the dim backdrop (tap it to resume).
 * Online leave asks an inline confirmation — opponents keep playing.
 *
 * A seat that has already finished also gets "See standings" here, so choosing
 * to watch the rest of the match never costs them the way back to the results.
 */

import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { Easing, FadeIn, FadeOut, SlideInDown, SlideOutDown } from "react-native-reanimated";
import { Button } from "./Button";
import { SettingRow } from "./SettingRow";
import { useNav } from "../store/navStore";
import { useSettings } from "../store/settingsStore";
import { depth, font, palette, radius, space, teamColor } from "../theme";
import { useT } from "../i18n";

interface PauseMenuProps {
  onResume: () => void;
  onLeave: () => void;
  /** Two-step leave (online: leaving abandons the match for you only). */
  confirmLeave?: boolean;
  /** Coins this seat staked and would forfeit by walking out mid-match. 0 for a
   *  friendly game, and 0 once this seat has finished (their place is banked). */
  forfeitCoins?: number;
  /** Set only for a seat that has already brought all four tokens home: reopen
   *  the standings they may have dismissed to watch the rest of the match. */
  onSeeStandings?: () => void;
}

export function PauseMenu({ onResume, onLeave, confirmLeave = false, forfeitCoins = 0, onSeeStandings }: PauseMenuProps) {
  const t = useT();
  const settings = useSettings();
  const push = useNav((s) => s.push);
  const [confirming, setConfirming] = useState(false);

  return (
    // zIndex above the game HUD — the corner-chip rows carry zIndex (for chat
    // bubbles) and would otherwise draw over this sheet on iOS.
    <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 40 }}>
      <Animated.View
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(160)}
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(20,23,28,0.72)" }}
      >
        <Pressable accessibilityLabel={t("game.resume")} style={{ flex: 1 }} onPress={onResume} />
      </Animated.View>

      <Animated.View
        entering={SlideInDown.duration(260).easing(Easing.out(Easing.cubic))}
        exiting={SlideOutDown.duration(180)}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: palette.raisedSlate,
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
          borderWidth: 1,
          borderColor: palette.hairline,
          borderTopColor: depth.highlight,
          shadowColor: "#000",
          shadowOpacity: 0.4,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -6 },
          elevation: 12,
          paddingHorizontal: space.xl,
          paddingTop: space.lg,
          paddingBottom: space.xxl,
          gap: space.sm,
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontFamily: font.display, fontSize: 20, color: palette.porcelain }}>{t("game.paused")}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t("game.resume")} onPress={onResume} hitSlop={8}>
            <Text style={{ fontFamily: font.semibold, fontSize: 22, color: palette.mutedSteel }}>×</Text>
          </Pressable>
        </View>

        <SettingRow label={t("settings.soundEffects")} value={settings.soundOn} onChange={settings.setSound} />
        <SettingRow label={t("settings.music")} value={settings.musicOn} onChange={settings.setMusic} />
        <SettingRow label={t("settings.haptics")} value={settings.hapticsOn} onChange={settings.setHaptics} />

        {onSeeStandings ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("game.seeStandings")}
            onPress={onSeeStandings}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", minHeight: 48, opacity: pressed ? 0.85 : 1 })}
          >
            <Text style={{ flex: 1, fontFamily: font.medium, fontSize: 16, color: palette.porcelain }}>{t("game.seeStandings")}</Text>
            <Text style={{ fontFamily: font.semibold, fontSize: 20, color: palette.mutedSteel }}>›</Text>
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("rules.title")}
          onPress={() => push("howToPlay")}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", minHeight: 48, opacity: pressed ? 0.85 : 1 })}
        >
          <Text style={{ flex: 1, fontFamily: font.medium, fontSize: 16, color: palette.porcelain }}>{t("rules.title")}</Text>
          <Text style={{ fontFamily: font.semibold, fontSize: 20, color: palette.mutedSteel }}>›</Text>
        </Pressable>

        <View style={{ height: 1, backgroundColor: palette.hairline, marginVertical: space.xs }} />

        {confirming ? (
          <View style={{ gap: space.sm }}>
            <Text style={{ fontFamily: font.medium, fontSize: 15, color: palette.porcelain, textAlign: "center" }}>
              {forfeitCoins > 0
                ? `Leave now and your ${forfeitCoins}-coin entry is gone — you can't win it back. The others keep playing.`
                : t("game.leaveMatchBody")}
            </Text>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Button label="Stay" variant="ghost" onPress={() => setConfirming(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label={t("lobby.leave")} color={teamColor.red} textColor={palette.porcelain} onPress={onLeave} />
              </View>
            </View>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("game.leaveGame")}
            onPress={() => (confirmLeave ? setConfirming(true) : onLeave())}
            style={({ pressed }) => ({ minHeight: 48, justifyContent: "center", opacity: pressed ? 0.85 : 1 })}
          >
            <Text style={{ fontFamily: font.semibold, fontSize: 16, color: teamColor.red }}>{t("game.leaveGame")}</Text>
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}
