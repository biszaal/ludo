/**
 * Stats body — local totals per mode and recent match history (device-only;
 * online identity is anonymous, so there is nothing meaningful to sync).
 * Rendered inside the Account screen below the identity/account trays, so this
 * is just the content (no header/scroller of its own). Empty state is a compact
 * card, never bare text.
 */

import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { Canvas, Group } from "@shopify/react-native-skia";
import { SectionLabel } from "./SectionLabel";
import { Surface3D } from "./Surface3D";
import { BoardSurface, PawnShape } from "./Board";
import { CycleGlyph, PeopleGlyph } from "./HomeGlyphs";
import { BOARD_THEMES } from "../render/boardThemes";
import { useSettings } from "../store/settingsStore";
import { useStats, type MatchMode, type MatchRecord } from "../store/statsStore";
import { font, palette, radius, space } from "../theme";

const MODE_LABEL: Record<MatchMode, string> = { ai: "vs AI", pass: "Pass & play", online: "Online" };

export function StatsContent() {
  const totals = useStats((s) => s.totals);
  const recent = useStats((s) => s.recent);
  const boardTheme = BOARD_THEMES[useSettings((s) => s.boardThemeId)];

  const played = totals.ai.played + totals.pass.played + totals.online.played;

  if (played === 0) {
    return (
      <View style={{ gap: space.sm }}>
        <SectionLabel>Stats</SectionLabel>
        <Surface3D rad={radius.lg} faceStyle={{ padding: space.lg, alignItems: "center", gap: space.sm }}>
          <Canvas style={{ width: 64, height: 64 }}>
            <BoardSurface size={64} theme={boardTheme} />
          </Canvas>
          <Text style={{ fontFamily: font.semibold, fontSize: 16, color: palette.porcelain, textAlign: "center" }}>
            No matches yet
          </Text>
          <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel, textAlign: "center" }}>
            Your first game will land here — wins, streaks and history.
          </Text>
        </Surface3D>
      </View>
    );
  }

  return (
    <>
      {/* Totals per mode */}
      <View style={{ gap: space.sm }}>
        <SectionLabel>Totals</SectionLabel>
        {(Object.keys(MODE_LABEL) as MatchMode[])
          .filter((m) => totals[m].played > 0)
          .map((m) => (
            <ModeTray
              key={m}
              mode={m}
              glyph={modeGlyph(m, boardTheme)}
              played={totals[m].played}
              won={m === "pass" ? null : totals[m].won}
            />
          ))}
      </View>

      {/* Recent matches */}
      <View style={{ gap: space.sm }}>
        <SectionLabel>Recent</SectionLabel>
        {recent.map((r) => (
          <MatchRow key={r.id} r={r} />
        ))}
      </View>
    </>
  );
}

/** Drawn per-mode mark: vs AI = two pawns squaring off, pass = hand-off loop,
 *  online = two player silhouettes. */
function modeGlyph(m: MatchMode, theme: (typeof BOARD_THEMES)[keyof typeof BOARD_THEMES]): ReactNode {
  if (m === "pass") return <CycleGlyph size={22} />;
  if (m === "online") return <PeopleGlyph size={22} />;
  return (
    <Canvas style={{ width: 26, height: 22 }}>
      <Group transform={[{ translateX: 17 }, { translateY: 13 }]}>
        <PawnShape r={6} color={theme.team.blue} stroke={theme.pawnStroke} />
      </Group>
      <Group transform={[{ translateX: 8 }, { translateY: 15 }]}>
        <PawnShape r={7} color={theme.team.red} stroke={theme.pawnStroke} />
      </Group>
    </Canvas>
  );
}

function ModeTray({ mode, glyph, played, won }: { mode: MatchMode; glyph: ReactNode; played: number; won: number | null }) {
  const rate = won === null ? null : Math.round((won / played) * 100);
  return (
    <Surface3D rad={radius.lg} faceStyle={{ padding: space.md, gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <View style={{ width: 28, alignItems: "center" }}>{glyph}</View>
        <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 15, color: palette.porcelain }}>{MODE_LABEL[mode]}</Text>
        <Stat label="played" value={`${played}`} />
        {won !== null ? <Stat label="won" value={`${won}`} /> : null}
        {rate !== null ? <Stat label="win rate" value={`${rate}%`} /> : null}
      </View>
      {rate !== null ? (
        <View style={{ height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
          <View style={{ width: `${rate}%`, height: 4, borderRadius: 2, backgroundColor: palette.mutedSteel }} />
        </View>
      ) : null}
    </Surface3D>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ alignItems: "flex-end", minWidth: 52 }}>
      <Text style={{ fontFamily: font.mono, fontSize: 15, color: palette.porcelain }}>{value}</Text>
      <Text style={{ fontFamily: font.regular, fontSize: 11, color: palette.mutedSteel }}>{label}</Text>
    </View>
  );
}

function MatchRow({ r }: { r: MatchRecord }) {
  const won = r.didWin === true;
  return (
    <Surface3D edge={2} rad={radius.md} faceStyle={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.md }}>
      {/* Neutral outcome badge — team colors stay on the board. */}
      <View
        style={{
          minWidth: 40,
          paddingHorizontal: 6,
          paddingVertical: 3,
          borderRadius: radius.pill,
          backgroundColor: won ? palette.porcelain : "rgba(255,255,255,0.08)",
          alignItems: "center",
        }}
      >
        <Text style={{ fontFamily: font.semibold, fontSize: 10, color: won ? palette.feltCharcoal : palette.mutedSteel }}>
          {won ? "WIN" : "—"}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: font.semibold, fontSize: 14, color: palette.porcelain }}>
          {r.winnerLabel} won{won ? " — you!" : ""}
        </Text>
        <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>
          {MODE_LABEL[r.mode]} · {r.players} players
        </Text>
      </View>
      <Text style={{ fontFamily: font.mono, fontSize: 12, color: palette.mutedSteel }}>{when(r.finishedAt)}</Text>
    </Surface3D>
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
