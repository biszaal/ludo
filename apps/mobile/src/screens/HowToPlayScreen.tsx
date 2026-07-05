/**
 * How to play — six illustrated rules sections. Static content; diagrams render
 * in the player's selected board theme. Reachable from Settings and (later) the
 * in-game pause menu.
 */

import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/Button";
import {
  CaptureDiagram,
  HomeColumnDiagram,
  ObjectiveDiagram,
  RollSixDiagram,
  SafeSquareDiagram,
  WinDiagram,
} from "../components/HowToPlayDiagrams";
import { BOARD_THEMES } from "../render/boardThemes";
import { useNav } from "../store/navStore";
import { useSettings } from "../store/settingsStore";
import { font, palette, radius, space } from "../theme";

const SECTIONS = [
  {
    key: "objective",
    title: "The goal",
    body: "Race all four of your pawns around the board and into the center before anyone else. Everyone moves clockwise around the same track.",
    Diagram: ObjectiveDiagram,
  },
  {
    key: "roll",
    title: "Rolling & sixes",
    body: "Roll a six to move a pawn out of your yard onto your start square. A six also earns another roll — but three sixes in a row forfeits the turn.",
    Diagram: RollSixDiagram,
  },
  {
    key: "capture",
    title: "Captures",
    body: "Land exactly on an opponent's pawn and it is sent back to its yard to start over. Capturing earns you a bonus roll.",
    Diagram: CaptureDiagram,
  },
  {
    key: "safe",
    title: "Safe squares",
    body: "Squares marked with a star are safe ground. Pawns there can't be captured, and opponents may share the square with you.",
    Diagram: SafeSquareDiagram,
  },
  {
    key: "home",
    title: "The home stretch",
    body: "After a full lap, your pawns turn up your colored column. Only your pawns may enter it, and a pawn needs an exact roll to reach the center.",
    Diagram: HomeColumnDiagram,
  },
  {
    key: "win",
    title: "Winning",
    body: "The first player to bring all four pawns to the center wins the game. Finishing a pawn also earns a bonus roll.",
    Diagram: WinDiagram,
  },
] as const;

export function HowToPlayScreen() {
  const { width } = useWindowDimensions();
  const theme = BOARD_THEMES[useSettings((s) => s.boardThemeId)];
  const pop = useNav((s) => s.pop);
  const diagramWidth = width - space.xl * 2 - space.lg * 2;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.feltCharcoal }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.xl, paddingTop: space.sm }}>
        <Text style={{ fontFamily: font.display, fontSize: 22, color: palette.porcelain }}>How to play</Text>
        <Button label="Back" onPress={pop} variant="ghost" />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.xxl, gap: space.lg }}>
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
            <Text style={{ fontFamily: font.semibold, fontSize: 17, color: palette.porcelain }}>{title}</Text>
            <Text style={{ fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: palette.mutedSteel }}>{body}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
