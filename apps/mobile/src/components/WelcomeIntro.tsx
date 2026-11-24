/**
 * The welcome intro: a brand-new player's first screen after their name
 * (who sees it: lib/firstGame.ts; wiring: lib/useWelcomeIntro.ts).
 *
 * Two rule cards, each on screen for a few seconds or until tapped, then the
 * choice of game: 2 players or 4 players online at the lowest entry, or a game
 * against the AI offline. Each choice is one tap into a game, so the intro
 * costs a new player no more taps than the one-tap PLAY it replaced, and it
 * shows them the 4-player table that the one-tap start never did.
 *
 * Skip is on screen from the first frame and lands on Home, where PLAY opens
 * the usual setup popup. With a screen reader on, the cards wait for the
 * player instead of moving on by themselves.
 */

import { useEffect, useState } from "react";
import { AccessibilityInfo, BackHandler, Pressable, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeIn } from "react-native-reanimated";
import { TableBackground } from "./TableBackground";
import { ContentColumn } from "./ContentColumn";
import { Button } from "./Button";
import { Surface3D } from "./Surface3D";
import { TableSeats } from "./TableSeats";
import { CoinGlyph } from "./CoinsPill";
import { CaptureDiagram, RollSixDiagram } from "./HowToPlayDiagrams";
import { formatCompact } from "../lib/format";
import { useLayout } from "../lib/useLayout";
import { resolveBoardTheme } from "../render/boardThemes";
import { useSettings } from "../store/settingsStore";
import { font, palette, radius, space } from "../theme";
import { useT } from "../i18n";

export type IntroChoice = 2 | 4 | "ai";

/** How long each rule card stays before the next one, unless tapped. */
const CARD_MS = 3500;

const CARDS = [
  { title: "intro.rollTitle", body: "intro.rollBody", Diagram: RollSixDiagram },
  { title: "intro.captureTitle", body: "intro.captureBody", Diagram: CaptureDiagram },
] as const;
const STEPS = CARDS.length + 1;

interface WelcomeIntroProps {
  /** The entry quoted on the online choices (the lowest tier). */
  entry: number;
  onPick: (choice: IntroChoice) => void;
  onSkip: () => void;
}

export function WelcomeIntro({ entry, onPick, onSkip }: WelcomeIntroProps) {
  const t = useT();
  const theme = resolveBoardTheme(useSettings((s) => s.boardThemeId));
  const { width } = useWindowDimensions();
  const { maxWidth } = useLayout();
  const diagramWidth = Math.min(width, maxWidth ?? width) - space.xl * 2 - space.lg * 2;
  const [step, setStep] = useState(0);
  const [reader, setReader] = useState(false);
  const choosing = step === STEPS - 1;
  const next = () => setStep((s) => Math.min(s + 1, STEPS - 1));

  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled()
      .then(setReader)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (choosing || reader) return;
    const id = setTimeout(next, CARD_MS);
    return () => clearTimeout(id);
  }, [step, choosing, reader]);

  // Android back is a skip, not an exit from the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onSkip();
      return true;
    });
    return () => sub.remove();
  }, [onSkip]);

  const card = CARDS[step];

  return (
    <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: palette.tableBlue }}>
      <TableBackground />
      <SafeAreaView style={{ flex: 1 }}>
        <ContentColumn style={{ flex: 1, paddingHorizontal: space.xl }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: space.sm }}>
            <View style={{ flexDirection: "row", gap: 6 }} accessible={false}>
              {Array.from({ length: STEPS }, (_, i) => (
                <View
                  key={i}
                  style={{
                    width: i === step ? 22 : 8,
                    height: 8,
                    borderRadius: radius.pill,
                    backgroundColor: i <= step ? palette.porcelain : palette.hairline,
                  }}
                />
              ))}
            </View>
            <Button label={t("intro.skip")} onPress={onSkip} variant="ghost" compact />
          </View>

          <View style={{ flex: 1, justifyContent: "center", gap: space.lg }}>
            {card ? (
              <Animated.View key={step} entering={FadeIn.duration(260)} style={{ gap: space.lg }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t(card.title)}. ${t(card.body)}`}
                  accessibilityHint={t("intro.next")}
                  onPress={next}
                  style={{
                    backgroundColor: palette.raisedSlate,
                    borderRadius: radius.lg,
                    borderWidth: 1,
                    borderColor: palette.hairline,
                    padding: space.lg,
                    gap: space.md,
                  }}
                >
                  <card.Diagram width={diagramWidth} theme={theme} />
                  <Text style={{ fontFamily: font.display, fontSize: 24, color: palette.porcelain }}>{t(card.title)}</Text>
                  <Text style={{ fontFamily: font.regular, fontSize: 16, lineHeight: 23, color: palette.mutedSteel }}>
                    {t(card.body)}
                  </Text>
                </Pressable>
                <Button label={t("intro.next")} onPress={next} />
              </Animated.View>
            ) : (
              <Animated.View entering={FadeIn.duration(260)} style={{ gap: space.lg }}>
                <Text
                  accessibilityRole="header"
                  style={{ fontFamily: font.display, fontSize: 28, color: palette.porcelain, textAlign: "center" }}
                >
                  {t("intro.chooseTitle")}
                </Text>
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <ChoiceTile size={2} title={t("intro.twoPlayers")} entry={entry} onPress={() => onPick(2)} />
                  <ChoiceTile size={4} title={t("intro.fourPlayers")} entry={entry} onPress={() => onPick(4)} />
                </View>
                <Button label={t("intro.vsAi")} onPress={() => onPick("ai")} variant="ghost" />
                <Text style={{ fontFamily: font.regular, fontSize: 14, lineHeight: 20, color: palette.mutedSteel, textAlign: "center" }}>
                  {t("intro.changeLater")}
                </Text>
              </Animated.View>
            )}
          </View>
        </ContentColumn>
      </SafeAreaView>
    </View>
  );
}

/** An online table as a choice: its seats, its size, and the entry it costs. */
function ChoiceTile({ size, title, entry, onPress }: { size: 2 | 4; title: string; entry: number; onPress: () => void }) {
  const t = useT();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("intro.entryA11y", { players: title, coins: entry })}
      onPress={onPress}
      style={{ flex: 1 }}
    >
      {({ pressed }) => (
        <Surface3D
          pressed={pressed}
          faceColor={palette.liftedSlate}
          faceStyle={{ alignItems: "center", paddingVertical: space.lg, gap: space.sm, borderRadius: radius.md }}
        >
          <TableSeats size={size} boardSize={84} />
          <Text style={{ fontFamily: font.display, fontSize: 18, color: palette.porcelain }}>{title}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <CoinGlyph size={16} />
            <Text style={{ fontFamily: font.semibold, fontSize: 15, color: palette.porcelain }}>{formatCompact(entry)}</Text>
          </View>
        </Surface3D>
      )}
    </Pressable>
  );
}
