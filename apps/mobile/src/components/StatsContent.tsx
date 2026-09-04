/**
 * Stats body — local totals per mode and recent match history (device-only;
 * online identity is anonymous, so there is nothing meaningful to sync).
 * Rendered inside the Account screen below the identity/account trays, so this
 * is just the content (no header/scroller of its own). Empty state is a compact
 * card, never bare text.
 *
 * Totals and history are each ONE tray of hairline-separated rows — the shape
 * Settings already uses. A separate raised card per mode and per match read as
 * a pile of unrelated objects on a screen that carries three trays above them.
 *
 * History is paged. The store keeps 30 matches (statsStore's HISTORY_CAP), and
 * mounting all 30 rows costs layout for history nobody has scrolled to yet.
 * RECENT_PAGE rows render; the Account screen hands down a `loadMoreSignal`
 * tick each time its scroll reaches the bottom, and each tick reveals one more
 * page. The "Show more" row does the same by hand — the tick needs a scroll
 * that lands on the end, which a short list or a screen reader may never make.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Canvas, Group } from "@shopify/react-native-skia";
import { SectionLabel } from "./SectionLabel";
import { Surface3D } from "./Surface3D";
import { BoardSurface, PawnShape } from "./Board";
import { CycleGlyph, PeopleGlyph } from "./HomeGlyphs";
import { resolveBoardTheme, type BoardTheme } from "../render/boardThemes";
import { useSettings } from "../store/settingsStore";
import { useStats, type MatchMode, type MatchRecord } from "../store/statsStore";
import { font, palette, radius, space } from "../theme";

const MODE_LABEL: Record<MatchMode, string> = { ai: "vs AI", pass: "Pass & play", online: "Online" };

/** Matches rendered per page — one screenful of history, no more. */
const RECENT_PAGE = 6;

interface StatsContentProps {
  /** Increments each time the host scroll view reaches its end; every rise
   *  reveals one more page of history. Starts at 0, so the mount pass is a
   *  no-op and the first page is all that renders. */
  loadMoreSignal?: number;
}

export function StatsContent({ loadMoreSignal = 0 }: StatsContentProps) {
  const totals = useStats((s) => s.totals);
  const recent = useStats((s) => s.recent);
  const boardTheme = resolveBoardTheme(useSettings((s) => s.boardThemeId));
  const [visible, setVisible] = useState(RECENT_PAGE);

  // Clamped to what the list actually holds, through a ref so a match finishing
  // is not itself a reason to reveal a page. Left to run away, `visible` would
  // sit far past the end after a few bounces at the bottom, and the next games
  // you played would land already-expanded.
  const total = useRef(recent.length);
  total.current = recent.length;
  useEffect(() => {
    if (!loadMoreSignal) return;
    setVisible((v) => Math.min(v + RECENT_PAGE, Math.max(RECENT_PAGE, total.current)));
  }, [loadMoreSignal]);

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

  const shown = recent.slice(0, visible);
  const hidden = recent.length - shown.length;
  const modes = (Object.keys(MODE_LABEL) as MatchMode[]).filter((m) => totals[m].played > 0);

  return (
    <>
      {/* Totals per mode */}
      <View style={{ gap: space.sm }}>
        <SectionLabel>Totals</SectionLabel>
        <Surface3D rad={radius.lg} faceStyle={{ paddingHorizontal: space.lg }}>
          {modes.map((m, i) => (
            <View key={m}>
              {i > 0 ? <Hairline /> : null}
              <ModeRow
                mode={m}
                glyph={modeGlyph(m, boardTheme)}
                played={totals[m].played}
                won={m === "pass" ? null : totals[m].won}
              />
            </View>
          ))}
        </Surface3D>
      </View>

      {/* Recent matches — a page at a time */}
      <View style={{ gap: space.sm }}>
        <SectionLabel>Recent</SectionLabel>
        <Surface3D rad={radius.lg} faceStyle={{ paddingHorizontal: space.lg }}>
          {shown.map((r, i) => (
            <View key={r.id}>
              {i > 0 ? <Hairline /> : null}
              <MatchRow r={r} />
            </View>
          ))}

          {hidden > 0 ? (
            <>
              <Hairline />
              <MoreRow
                label={`Show ${Math.min(RECENT_PAGE, hidden)} more`}
                count={`${shown.length}/${recent.length}`}
                onPress={() => setVisible((v) => Math.min(v + RECENT_PAGE, recent.length))}
              />
            </>
          ) : recent.length > RECENT_PAGE ? (
            <>
              <Hairline />
              <MoreRow
                label="Show less"
                count={`${recent.length}/${recent.length}`}
                onPress={() => setVisible(RECENT_PAGE)}
              />
            </>
          ) : null}
        </Surface3D>
      </View>
    </>
  );
}

function Hairline() {
  return <View style={{ height: 1, backgroundColor: palette.hairline }} />;
}

/** Drawn per-mode mark: vs AI = two pawns squaring off, pass = hand-off loop,
 *  online = two player silhouettes. */
function modeGlyph(m: MatchMode, theme: BoardTheme): ReactNode {
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

function ModeRow({ mode, glyph, played, won }: { mode: MatchMode; glyph: ReactNode; played: number; won: number | null }) {
  const rate = won === null ? null : Math.round((won / played) * 100);
  return (
    <View style={{ paddingVertical: space.md, gap: space.sm }}>
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
    </View>
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
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56, paddingVertical: space.sm }}>
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
    </View>
  );
}

/** The paging row that closes the history tray: what it does on the left, how
 *  far through the list you are on the right. */
function MoreRow({ label, count, onPress }: { label: string; count: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        minHeight: 48,
        gap: space.md,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ flex: 1, fontFamily: font.medium, fontSize: 14, color: palette.porcelain }}>{label}</Text>
      <Text style={{ fontFamily: font.mono, fontSize: 12, color: palette.mutedSteel }}>{count}</Text>
    </Pressable>
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
