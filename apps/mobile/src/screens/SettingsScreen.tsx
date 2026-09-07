/**
 * Settings — device preferences (sound / music / haptics) and How to play.
 * Everything saves instantly via the persisted stores; there is no Save
 * button. Doorways the Home dock already owns (Shop, Stats, Profile) don't
 * repeat here — Settings owns the device, not the account.
 */

import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TableBackground } from "../components/TableBackground";
import { ScreenHeader } from "../components/ScreenHeader";
import { ContentColumn } from "../components/ContentColumn";
import { SectionLabel } from "../components/SectionLabel";
import { SettingRow } from "../components/SettingRow";
import { FeedbackSheet } from "../components/FeedbackSheet";
import { registerForPush, unregisterPush } from "../lib/push";
import { cancelBonusReminder, scheduleBonusReminder } from "../lib/bonusReminder";
import { Surface3D } from "../components/Surface3D";
import { BookGlyph, ChevronGlyph, CycleGlyph, NoteGlyph, PeopleGlyph, PulseGlyph, SpeakerGlyph, SpeechGlyph } from "../components/HomeGlyphs";
import { CoinGlyph } from "../components/CoinsPill";
import { LanguageSheet } from "../components/LanguageSheet";
import { GlobeGlyph } from "../components/HomeGlyphs";
import { LOCALE_NAMES, useLocale, useT } from "../i18n";
import { useNav } from "../store/navStore";
import { useFullMotion } from "../lib/useMotion";
import { useSettings } from "../store/settingsStore";
import { useWallet } from "../store/walletStore";
import { font, palette, radius, space } from "../theme";

import { APP_VERSION } from "../lib/appVersion";

export function SettingsScreen() {
  const settings = useSettings();
  const fullMotion = useFullMotion();
  const push = useNav((s) => s.push);
  const t = useT();
  const activeLocale = useLocale((s) => s.locale);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.tableBlue }}>
      <TableBackground />
      <ScreenHeader title={t("settings.title")} />

      <ScrollView contentContainerStyle={{ paddingTop: space.lg, paddingBottom: space.xxl, alignItems: "center" }}>
        <ContentColumn style={{ paddingHorizontal: space.xl, gap: space.xl }}>
        <Tray title={t("settings.soundAndFeel")}>
          <Row glyph={<SpeakerGlyph size={20} />}>
            <SettingRow label={t("settings.soundEffects")} hint={t("settings.soundEffectsHint")} value={settings.soundOn} onChange={settings.setSound} />
          </Row>
          <Hairline />
          <Row glyph={<NoteGlyph size={20} />}>
            <SettingRow label={t("settings.music")} hint={t("settings.musicHint")} value={settings.musicOn} onChange={settings.setMusic} />
          </Row>
          <Hairline />
          <Row glyph={<PulseGlyph size={20} />}>
            <SettingRow label={t("settings.haptics")} hint={t("settings.hapticsHint")} value={settings.hapticsOn} onChange={settings.setHaptics} />
          </Row>
          <Hairline />
          <Row glyph={<CycleGlyph size={20} />}>
            {/* A boolean switch over a three-state preference. The switch shows
                what the app is ACTUALLY doing, so on a phone we judged slow it
                already reads off — and touching it pins the choice, which is
                what stops a wrong guess being a trap. There is no way back to
                "auto" from here, and that is fine: once someone has an opinion,
                it should be the one that counts. */}
            <SettingRow
              label={t("settings.animations")}
              hint={
                fullMotion
                  ? t("settings.animationsFull")
                  : t("settings.animationsReduced")
              }
              value={fullMotion}
              onChange={(v) => settings.setMotionPref(v ? "full" : "reduced")}
            />
          </Row>
        </Tray>

        <Tray title={t("settings.notifications")}>
          <Row glyph={<PeopleGlyph size={20} />}>
            <SettingRow
              label={t("settings.notificationsInvites")}
              hint={t("settings.notificationsHint")}
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
              label={t("settings.bonusReminder")}
              hint={t("settings.bonusReminderHint")}
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

        <Tray title={t("settings.language")}>
          {/* A row rather than a switch: seven options, and the value worth
              showing is the language's own name in its own script. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("settings.language")}
            onPress={() => setLanguageOpen(true)}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", minHeight: 52, gap: space.md, opacity: pressed ? 0.85 : 1 })}
          >
            <GlobeGlyph size={20} />
            <Text style={{ flex: 1, fontFamily: font.medium, fontSize: 16, color: palette.porcelain }}>
              {t("settings.language")}
            </Text>
            <Text style={{ fontFamily: font.medium, fontSize: 15, color: palette.mutedSteel }}>
              {LOCALE_NAMES[activeLocale]}
            </Text>
            <ChevronGlyph size={16} />
          </Pressable>
        </Tray>

        <Tray title={t("rules.learn")}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("settings.howToPlay")}
            onPress={() => push("howToPlay")}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", minHeight: 52, gap: space.md, opacity: pressed ? 0.85 : 1 })}
          >
            <BookGlyph size={20} />
            <Text style={{ flex: 1, fontFamily: font.medium, fontSize: 16, color: palette.porcelain }}>{t("settings.howToPlay")}</Text>
            <ChevronGlyph size={16} />
          </Pressable>
        </Tray>

        <Tray title={t("settings.about")}>
          {/* Feedback sits here rather than under Learn because the report
              carries the build with it — version and phone are attached by
              net/api, and this is the tray that already names the version. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("settings.sendFeedback")}
            onPress={() => setFeedbackOpen(true)}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", minHeight: 52, gap: space.md, opacity: pressed ? 0.85 : 1 })}
          >
            <SpeechGlyph size={20} />
            <Text style={{ flex: 1, fontFamily: font.medium, fontSize: 16, color: palette.porcelain }}>{t("settings.sendFeedback")}</Text>
            <ChevronGlyph size={16} />
          </Pressable>
          <Hairline />
          <View style={{ minHeight: 44, justifyContent: "center" }}>
            <Text style={{ fontFamily: font.mono, fontSize: 12, color: palette.mutedSteel }}>Ludo · v{APP_VERSION}</Text>
          </View>
        </Tray>
      </ContentColumn>
      </ScrollView>

      {feedbackOpen ? <FeedbackSheet onClose={() => setFeedbackOpen(false)} /> : null}
      {languageOpen ? <LanguageSheet onClose={() => setLanguageOpen(false)} /> : null}
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
