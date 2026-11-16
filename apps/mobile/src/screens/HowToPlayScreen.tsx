/**
 * How to play — six illustrated rules sections, plus two text cards for online
 * seats and online dice. Static content; diagrams render in the player's
 * selected board theme. Reachable from Settings, the pause menu, and the
 * matchmaking fair-play link (which scrolls to the online cards).
 */

import { useRef } from "react";
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

/** Set by the matchmaking link; the next mount of this screen scrolls to it. */
let pendingOnlineFocus = false;

/** Opens How to play on the online-seat and online-dice cards. */
export function openOnlineRules(): void {
  pendingOnlineFocus = true;
  useNav.getState().push("howToPlay");
}

function consumeOnlineRulesFocus(): boolean {
  const on = pendingOnlineFocus;
  pendingOnlineFocus = false;
  return on;
}

/**
 * The sections, as KEYS rather than text.
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
  // No diagram: these say what the server does, and none of the board sketches
  // is that. Same card chrome as the illustrated rules above them.
  { key: "onlineBots", title: "rules.onlineBots", body: "rules.onlineBotsBody", Diagram: null },
  { key: "onlineDice", title: "rules.onlineDice", body: "rules.onlineDiceBody", Diagram: null },
] as const;

export function HowToPlayScreen() {
  const { width } = useWindowDimensions();
  const { maxWidth } = useLayout();
  const theme = resolveBoardTheme(useSettings((s) => s.boardThemeId));
  const pop = useNav((s) => s.pop);
  const t = useT();
  // Diagrams size to the (capped) column, not the full iPad width.
  const diagramWidth = Math.min(width, maxWidth ?? width) - space.xl * 2 - space.lg * 2;
  const scrollRef = useRef<ScrollView>(null);
  const scrollHostRef = useRef<View>(null);
  const onlineRef = useRef<View>(null);
  const didReveal = useRef(false);
  // Read once: Settings and the pause menu open this screen with no target,
  // and a second visit must not inherit a focus the link already spent.
  const focusOnline = useRef(consumeOnlineRulesFocus()).current;

  const revealOnline = () => {
    if (!focusOnline || didReveal.current) return;
    const anchor = onlineRef.current;
    const host = scrollHostRef.current;
    const scroll = scrollRef.current;
    if (!anchor || !host || !scroll) return;
    // Positions in the window, so padding on the scroll content does not have
    // to be added by hand. The cards sit at the end; this brings the first
    // one up to the top of the scroller. Once is enough — repeating it would
    // pin the list and stop the player scrolling back up.
    anchor.measureInWindow((_x, anchorY) => {
      host.measureInWindow((_sx, scrollY) => {
        if (didReveal.current) return;
        if (anchorY === 0 && scrollY === 0) return;
        didReveal.current = true;
        scroll.scrollTo({ y: Math.max(0, anchorY - scrollY), animated: false });
      });
    });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.tableBlue }}>
      <TableBackground />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.xl, paddingTop: space.sm }}>
        <Text style={{ fontFamily: font.display, fontSize: 22, color: palette.porcelain }}>{t("rules.title")}</Text>
        <Button label={t("common.back")} onPress={pop} variant="ghost" />
      </View>

      <View ref={scrollHostRef} collapsable={false} style={{ flex: 1 }}>
        <ScrollView ref={scrollRef} contentContainerStyle={{ paddingTop: space.lg, paddingBottom: space.xxl, alignItems: "center" }}>
          <ContentColumn style={{ paddingHorizontal: space.xl, gap: space.lg }}>
          {SECTIONS.map(({ key, title, body, Diagram }) => (
            <View
              key={key}
              ref={key === "onlineBots" ? onlineRef : undefined}
              collapsable={false}
              onLayout={key === "onlineBots" ? () => requestAnimationFrame(revealOnline) : undefined}
              style={{
                backgroundColor: palette.raisedSlate,
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: palette.hairline,
                padding: space.lg,
                gap: space.md,
              }}
            >
              {Diagram ? <Diagram width={diagramWidth} theme={theme} /> : null}
              <Text style={{ fontFamily: font.semibold, fontSize: 17, color: palette.porcelain }}>{t(title)}</Text>
              <Text style={{ fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: palette.mutedSteel }}>{t(body)}</Text>
            </View>
          ))}
          </ContentColumn>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
