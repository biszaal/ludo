/**
 * Stats — local totals per mode and recent match history (device-only; online
 * identity is anonymous, so there is nothing meaningful to sync). Zero state is
 * a composed card, never bare text.
 */

import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TableBackground } from "../components/TableBackground";
import { Canvas } from "@shopify/react-native-skia";
import { Button } from "../components/Button";
import { BoardSurface } from "../components/Board";
import { BOARD_THEMES } from "../render/boardThemes";
import { useNav } from "../store/navStore";
import { useSettings } from "../store/settingsStore";
import { useStats, type MatchMode, type MatchRecord } from "../store/statsStore";
import { font, palette, radius, space, teamColor } from "../theme";

const MODE_LABEL: Record<MatchMode, string> = { ai: "vs AI", pass: "Pass & play", online: "Online" };

export function StatsScreen() {
  const totals = useStats((s) => s.totals);
  const recent = useStats((s) => s.recent);
  const pop = useNav((s) => s.pop);
  const boardTheme = BOARD_THEMES[useSettings((s) => s.boardThemeId)];

  const played = totals.ai.played + totals.pass.played + totals.online.played;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.tableBlue }}>
      <TableBackground />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.xl, paddingTop: space.sm }}>
        <Text style={{ fontFamily: font.display, fontSize: 22, color: palette.porcelain }}>Stats</Text>
        <Button label="Back" onPress={pop} variant="ghost" />
      </View>

      {played === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl, gap: space.lg }}>
          <Canvas style={{ width: 96, height: 96 }}>
            <BoardSurface size={96} theme={boardTheme} />
          </Canvas>
          <Text style={{ fontFamily: font.semibold, fontSize: 17, color: palette.porcelain, textAlign: "center" }}>
            No matches yet
          </Text>
          <Text style={{ fontFamily: font.regular, fontSize: 14, color: palette.mutedSteel, textAlign: "center" }}>
            Your first game will land here — wins, streaks and history.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.xxl, gap: space.xl }}>
          {/* Totals per mode */}
          <View style={{ gap: space.sm }}>
            <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel, letterSpacing: 0.5 }}>TOTALS</Text>
            {(Object.keys(MODE_LABEL) as MatchMode[])
              .filter((m) => totals[m].played > 0)
              .map((m) => (
                <View
                  key={m}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    padding: space.md,
                    borderRadius: radius.md,
                    backgroundColor: palette.raisedSlate,
                    borderWidth: 1,
                    borderColor: palette.hairline,
                    gap: space.md,
                  }}
                >
                  <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 15, color: palette.porcelain }}>{MODE_LABEL[m]}</Text>
                  <Stat label="played" value={`${totals[m].played}`} />
                  {m !== "pass" ? <Stat label="won" value={`${totals[m].won}`} /> : null}
                  {m !== "pass" ? (
                    <Stat label="win rate" value={`${Math.round((totals[m].won / totals[m].played) * 100)}%`} />
                  ) : null}
                </View>
              ))}
          </View>

          {/* Recent matches */}
          <View style={{ gap: space.sm }}>
            <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel, letterSpacing: 0.5 }}>RECENT</Text>
            {recent.map((r) => (
              <MatchRow key={r.id} r={r} />
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ alignItems: "flex-end" }}>
      <Text style={{ fontFamily: font.mono, fontSize: 15, color: palette.porcelain }}>{value}</Text>
      <Text style={{ fontFamily: font.regular, fontSize: 11, color: palette.mutedSteel }}>{label}</Text>
    </View>
  );
}

function MatchRow({ r }: { r: MatchRecord }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingVertical: space.sm,
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        backgroundColor: palette.raisedSlate,
        borderWidth: 1,
        borderColor: palette.hairline,
      }}
    >
      <View style={{ width: 12, height: 12, borderRadius: radius.pill, backgroundColor: teamColor[r.winnerColor] }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: font.semibold, fontSize: 14, color: palette.porcelain }}>
          {r.winnerLabel} won{r.didWin === true ? " — you!" : ""}
        </Text>
        <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>
          {MODE_LABEL[r.mode]} · {r.players} players
        </Text>
      </View>
      <Text style={{ fontFamily: font.mono, fontSize: 12, color: palette.mutedSteel }}>{when(r.finishedAt)}</Text>
    </View>
  );
}

function when(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}
