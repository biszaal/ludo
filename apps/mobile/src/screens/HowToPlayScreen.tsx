/**
 * How to play — six illustrated rules sections. Static content; diagrams render
 * in the player's selected board theme. Reachable from Settings and (later) the
 * in-game pause menu.
 */

import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TableBackground } from "../components/TableBackground";
import { ContentColumn } from "../components/ContentColumn";
import { Button } from "../components/Button";
import { useLayout } from "../lib/useLayout";
import {
  CaptureDiagram,
  HomeColumnDiagram,
  ObjectiveDiagram,
  RollSixDiagram,
  SafeSquareDiagram,
  WinDiagram,
} from "../components/HowToPlayDiagrams";
import { resolveBoardTheme } from "../render/boardThemes";
import { useT } from "../i18n";
import { useNav } from "../store/navStore";
import { useSettings } from "../store/settingsStore";
import { font, palette, radius, space } from "../theme";

/**
 * The six sections, as KEYS rather than text.
 *
 * The strings move to the catalog; what stays here is the order and which
 * diagram goes with which rule, which is the part that is actually about this
 * screen. `as const` keeps the keys literal so the catalog's type checks them.
 */
const SECTIONS = [
  { key: "objective", title: "rules.goal", body: "rules.goalBody", Diagram: ObjectiveDiagram },
  { key: "roll", title: "rules.rolling", body: "rules.rollingBody", Diagram: RollSixDiagram },
  { key: "capture", title: "rules.captures", body: "rules.capturesBody", Diagram: CaptureDiagram },
  { key: "safe", title: "rules.safeSquares", body: "rules.safeSquaresBody", Diagram: SafeSquareDiagram },
  { key: "home", title: "rules.homeStretch", body: "rules.homeStretchBody", Diagram: HomeColumnDiagram },
  { key: "win", title: "rules.winning", body: "rules.winningBody", Diagram: WinDiagram },
] as const;

export function HowToPlayScreen() {
  const { width } = useWindowDimensions();
  const { maxWidth } = useLayout();
  const theme = resolveBoardTheme(useSettings((s) => s.boardThemeId));
  const pop = useNav((s) => s.pop);
  const t = useT();
  // Diagrams size to the (capped) column, not the full iPad width.
  const diagramWidth = Math.min(width, maxWidth ?? width) - space.xl * 2 - space.lg * 2;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.tableBlue }}>
      <TableBackground />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.xl, paddingTop: space.sm }}>
        <Text style={{ fontFamily: font.display, fontSize: 22, color: palette.porcelain }}>{t("rules.title")}</Text>
        <Button label={t("common.back")} onPress={pop} variant="ghost" />
      </View>

      <ScrollView contentContainerStyle={{ paddingTop: space.lg, paddingBottom: space.xxl, alignItems: "center" }}>
        <ContentColumn style={{ paddingHorizontal: space.xl, gap: space.lg }}>
        {SECTIONS.map(({ key, title, body, Diagram }) => (
          <View
            key={key}
            style={{
              backgroundColor: palette.raisedSlate,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: palette.hairline,
              padding: space.lg,
              gap: space.md,
            }}
          >
            <Diagram width={diagramWidth} theme={theme} />
            <Text style={{ fontFamily: font.semibold, fontSize: 17, color: palette.porcelain }}>{t(title)}</Text>
            <Text style={{ fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: palette.mutedSteel }}>{t(body)}</Text>
          </View>
        ))}
        </ContentColumn>
      </ScrollView>
    </SafeAreaView>
  );
}
