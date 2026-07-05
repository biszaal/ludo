/**
 * Settings — device preferences (sound / music / haptics), board skin picker,
 * and entry points to Profile and How to play. Everything saves instantly via
 * the persisted stores; there is no Save button.
 */

import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/Button";
import { SettingRow } from "../components/SettingRow";
import { ThemeSwatch } from "../components/ThemeSwatch";
import { AvatarGlyph } from "../components/Avatar";
import { BOARD_THEMES } from "../render/boardThemes";
import { useNav } from "../store/navStore";
import { useProfile } from "../store/profileStore";
import { useSettings } from "../store/settingsStore";
import { font, palette, radius, space } from "../theme";

// Version straight from app config — no expo-constants dependency needed.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const APP_VERSION: string = require("../../app.json").expo.version ?? "1.0.0";

export function SettingsScreen() {
  const settings = useSettings();
  const displayName = useProfile((s) => s.displayName);
  const avatarId = useProfile((s) => s.avatarId);
  const pop = useNav((s) => s.pop);
  const push = useNav((s) => s.push);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.feltCharcoal }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.xl, paddingTop: space.sm }}>
        <Text style={{ fontFamily: font.display, fontSize: 22, color: palette.porcelain }}>Settings</Text>
        <Button label="Back" onPress={pop} variant="ghost" />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.xxl, gap: space.xl }}>
        <Section title="SOUND">
          <SettingRow label="Sound effects" hint="Dice, hops and captures" value={settings.soundOn} onChange={settings.setSound} />
          <Hairline />
          <SettingRow label="Music" hint="Ambient table loop" value={settings.musicOn} onChange={settings.setMusic} />
        </Section>

        <Section title="FEEL">
          <SettingRow label="Haptics" hint="Gentle taps on rolls and moves" value={settings.hapticsOn} onChange={settings.setHaptics} />
        </Section>

        <Section title="BOARD">
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
            {Object.values(BOARD_THEMES).map((t) => (
              <ThemeSwatch key={t.id} theme={t} selected={t.id === settings.boardThemeId} onSelect={() => settings.setBoardTheme(t.id)} />
            ))}
          </View>
        </Section>

        <Section title="YOU">
          <LinkRow onPress={() => push("profile")} label={displayName} left={<AvatarGlyph id={avatarId} size={36} />} />
        </Section>

        <Section title="LEARN">
          <LinkRow onPress={() => push("howToPlay")} label="How to play" />
        </Section>

        <Text style={{ fontFamily: font.mono, fontSize: 12, color: palette.mutedSteel, textAlign: "center", marginTop: space.sm }}>
          Ludo · v{APP_VERSION}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel, letterSpacing: 0.5 }}>{title}</Text>
      <View style={{ backgroundColor: palette.raisedSlate, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.hairline, paddingHorizontal: space.lg, paddingVertical: space.xs }}>
        {children}
      </View>
    </View>
  );
}

function Hairline() {
  return <View style={{ height: 1, backgroundColor: palette.hairline }} />;
}

function LinkRow({ label, onPress, left }: { label: string; onPress: () => void; left?: React.ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        minHeight: 52,
        gap: space.md,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {left}
      <Text style={{ flex: 1, fontFamily: font.medium, fontSize: 16, color: palette.porcelain }}>{label}</Text>
      <Text style={{ fontFamily: font.semibold, fontSize: 20, color: palette.mutedSteel }}>›</Text>
    </Pressable>
  );
}
