/**
 * Settings — device preferences (sound / music / haptics) and How to play.
 * Everything saves instantly via the persisted stores; there is no Save
 * button. Doorways the Home dock already owns (Shop, Stats, Profile) don't
 * repeat here — Settings owns the device, not the account.
 */

import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TableBackground } from "../components/TableBackground";
import { ScreenHeader } from "../components/ScreenHeader";
import { ContentColumn } from "../components/ContentColumn";
import { SectionLabel } from "../components/SectionLabel";
import { SettingRow } from "../components/SettingRow";
import { registerForPush, unregisterPush } from "../lib/push";
import { cancelBonusReminder, scheduleBonusReminder } from "../lib/bonusReminder";
import { Surface3D } from "../components/Surface3D";
import { BookGlyph, ChevronGlyph, NoteGlyph, PeopleGlyph, PulseGlyph, SpeakerGlyph } from "../components/HomeGlyphs";
import { CoinGlyph } from "../components/CoinsPill";
import { useNav } from "../store/navStore";
import { useSettings } from "../store/settingsStore";
import { useWallet } from "../store/walletStore";
import { font, palette, radius, space } from "../theme";

// Version straight from app config — no expo-constants dependency needed.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const APP_VERSION: string = require("../../app.json").expo.version ?? "1.0.0";

export function SettingsScreen() {
  const settings = useSettings();
  const push = useNav((s) => s.push);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.tableBlue }}>
      <TableBackground />
      <ScreenHeader title="Settings" />

      <ScrollView contentContainerStyle={{ paddingTop: space.lg, paddingBottom: space.xxl, alignItems: "center" }}>
        <ContentColumn style={{ paddingHorizontal: space.xl, gap: space.xl }}>
        <Tray title="Sound & feel">
          <Row glyph={<SpeakerGlyph size={20} />}>
            <SettingRow label="Sound effects" hint="Dice, hops and captures" value={settings.soundOn} onChange={settings.setSound} />
          </Row>
          <Hairline />
          <Row glyph={<NoteGlyph size={20} />}>
            <SettingRow label="Music" hint="Ambient table loop" value={settings.musicOn} onChange={settings.setMusic} />
          </Row>
          <Hairline />
          <Row glyph={<PulseGlyph size={20} />}>
            <SettingRow label="Haptics" hint="Gentle taps on rolls and moves" value={settings.hapticsOn} onChange={settings.setHaptics} />
          </Row>
        </Tray>

        <Tray title="Notifications">
          <Row glyph={<PeopleGlyph size={20} />}>
            <SettingRow
              label="Friends"
              hint="Invites, requests, and when a friend comes online"
              value={settings.pushOn}
              onChange={(v) => {
                settings.setPush(v);
                // Registration is what actually starts/stops delivery; the
                // stored flag alone would leave a live token behind.
                void (v ? registerForPush() : unregisterPush());
              }}
            />
          </Row>
          <Hairline />
          <Row glyph={<CoinGlyph size={20} />}>
            <SettingRow
              label="Daily bonus"
              hint="A nudge when your free coins are ready"
              value={settings.bonusRemindersOn}
              onChange={(v) => {
                settings.setBonusReminders(v);
                // Scheduled on the device, so turning it on has to re-arm the
                // reminder from what the wallet already knows — waiting for the
                // next refresh would silently skip a day.
                const w = useWallet.getState();
                void (v ? scheduleBonusReminder(w.bonusClaimable, w.streakDay) : cancelBonusReminder());
              }}
            />
          </Row>
        </Tray>

        <Tray title="Learn">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="How to play"
            onPress={() => push("howToPlay")}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", minHeight: 52, gap: space.md, opacity: pressed ? 0.85 : 1 })}
          >
            <BookGlyph size={20} />
            <Text style={{ flex: 1, fontFamily: font.medium, fontSize: 16, color: palette.porcelain }}>How to play</Text>
            <ChevronGlyph size={16} />
          </Pressable>
        </Tray>

        <Tray title="About">
          <View style={{ minHeight: 44, justifyContent: "center" }}>
            <Text style={{ fontFamily: font.mono, fontSize: 12, color: palette.mutedSteel }}>Ludo · v{APP_VERSION}</Text>
          </View>
        </Tray>
      </ContentColumn>
      </ScrollView>
    </SafeAreaView>
  );
}

/** A raised settings tray: SectionLabel over a Surface3D card. */
function Tray({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <SectionLabel>{title}</SectionLabel>
      <Surface3D rad={radius.lg} faceStyle={{ paddingHorizontal: space.lg, paddingVertical: space.xs }}>
        {children}
      </Surface3D>
    </View>
  );
}

/** Glyph gutter beside a SettingRow, vertically centered on the row. */
function Row({ glyph, children }: { glyph: ReactNode; children: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
      {glyph}
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

function Hairline() {
  return <View style={{ height: 1, backgroundColor: palette.hairline }} />;
}
