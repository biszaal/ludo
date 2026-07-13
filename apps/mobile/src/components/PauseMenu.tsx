/**
 * In-game pause sheet: quick sound/music/haptics toggles, How to play, and
 * Leave. The game stays live behind the dim backdrop (tap it to resume).
 * Online leave asks an inline confirmation — opponents keep playing.
 */

import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { Easing, FadeIn, FadeOut, SlideInDown, SlideOutDown } from "react-native-reanimated";
import { Button } from "./Button";
import { SettingRow } from "./SettingRow";
import { useNav } from "../store/navStore";
import { useSettings } from "../store/settingsStore";
import { depth, font, palette, radius, space, teamColor } from "../theme";

interface PauseMenuProps {
  onResume: () => void;
  onLeave: () => void;
  /** Two-step leave (online: leaving abandons the match for you only). */
  confirmLeave?: boolean;
}

export function PauseMenu({ onResume, onLeave, confirmLeave = false }: PauseMenuProps) {
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
        <Pressable accessibilityLabel="Resume" style={{ flex: 1 }} onPress={onResume} />
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
          <Text style={{ fontFamily: font.display, fontSize: 20, color: palette.porcelain }}>Paused</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Resume" onPress={onResume} hitSlop={8}>
            <Text style={{ fontFamily: font.semibold, fontSize: 22, color: palette.mutedSteel }}>×</Text>
          </Pressable>
        </View>

        <SettingRow label="Sound effects" value={settings.soundOn} onChange={settings.setSound} />
        <SettingRow label="Music" value={settings.musicOn} onChange={settings.setMusic} />
        <SettingRow label="Haptics" value={settings.hapticsOn} onChange={settings.setHaptics} />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="How to play"
          onPress={() => push("howToPlay")}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", minHeight: 48, opacity: pressed ? 0.85 : 1 })}
        >
          <Text style={{ flex: 1, fontFamily: font.medium, fontSize: 16, color: palette.porcelain }}>How to play</Text>
          <Text style={{ fontFamily: font.semibold, fontSize: 20, color: palette.mutedSteel }}>›</Text>
        </Pressable>

        <View style={{ height: 1, backgroundColor: palette.hairline, marginVertical: space.xs }} />

        {confirming ? (
          <View style={{ gap: space.sm }}>
            <Text style={{ fontFamily: font.medium, fontSize: 15, color: palette.porcelain, textAlign: "center" }}>
              Leave the match? The others keep playing.
            </Text>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Button label="Stay" variant="ghost" onPress={() => setConfirming(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Leave" color={teamColor.red} textColor={palette.porcelain} onPress={onLeave} />
              </View>
            </View>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Leave game"
            onPress={() => (confirmLeave ? setConfirming(true) : onLeave())}
            style={({ pressed }) => ({ minHeight: 48, justifyContent: "center", opacity: pressed ? 0.85 : 1 })}
          >
            <Text style={{ fontFamily: font.semibold, fontSize: 16, color: teamColor.red }}>Leave game</Text>
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}
