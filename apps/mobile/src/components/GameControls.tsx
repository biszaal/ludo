/** Game toolbar controls; isolated from board and multiplayer rendering. */
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { clockStartFor, elapsedSeconds, formatElapsed } from "../lib/gameClock";
import { font, palette, radius, space, teamColor } from "../theme";
import { useT } from "../i18n";

/**
 * How long this game has been running, in the top bar.
 *
 * The clock keeps ticking on an opponent's turn — it's the match's age, not
 * anybody's shot clock (the turn countdown lives on the active seat's panel) —
 * and stops on the last word of the game so the results screen isn't sitting
 * over a number that's still climbing.
 */

export function GameClock({ gameId, running }: { gameId: string; running: boolean }) {
  const t = useT();
  const startedAt = clockStartFor(gameId);
  const [seconds, setSeconds] = useState(() => elapsedSeconds(startedAt));
  useEffect(() => {
    setSeconds(elapsedSeconds(startedAt));
    if (!running) return;
    // Twice a second: the displayed value floors the real elapsed time, so a
    // 1s interval out of phase with it shows each number up to a second late.
    const id = setInterval(() => setSeconds(elapsedSeconds(startedAt)), 500);
    return () => clearInterval(id);
  }, [startedAt, running]);

  return (
    <View
      accessible
      accessibilityLabel={t("game.elapsedA11y", { time: formatElapsed(seconds) })}
      style={{
        paddingHorizontal: space.sm,
        paddingVertical: 4,
        borderRadius: radius.pill,
        backgroundColor: palette.liftedSlate,
        borderTopWidth: 1,
        borderTopColor: "rgba(255,255,255,0.10)",
      }}
    >
      <Text
        style={{
          fontFamily: font.mono,
          fontSize: 13,
          color: palette.mutedSteel,
          // Digits change every second; a fixed width keeps the pill from
          // twitching as 9→10 or 59→1:00 changes the string's length.
          minWidth: 34,
          textAlign: "center",
        }}
      >
        {formatElapsed(seconds)}
      </Text>
    </View>
  );
}

/** Round emoji-glyph button in the game top bar (reactions, chat). */
export function IconButton({ label, glyph, onPress, showDot = false }: { label: string; glyph: string; onPress: () => void; showDot?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: radius.md,
        backgroundColor: palette.raisedSlate,
        borderWidth: 1,
        borderColor: palette.hairline,
        borderTopColor: "rgba(255,255,255,0.10)",
        alignItems: "center",
        justifyContent: "center",
        transform: [{ scale: pressed ? 0.94 : 1 }],
      })}
    >
      <Text style={{ fontSize: 20 }}>{glyph}</Text>
      {showDot ? (
        <View
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 9,
            height: 9,
            borderRadius: radius.pill,
            backgroundColor: teamColor.red,
          }}
        />
      ) : null}
    </Pressable>
  );
}

/** Drawn ≡ menu glyph — 44px target, no icon fonts. */
export function MenuButton({ onPress }: { onPress: () => void }) {
  const t = useT();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("game.gameMenu")}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: radius.md,
        backgroundColor: palette.raisedSlate,
        borderWidth: 1,
        borderColor: palette.hairline,
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        transform: [{ scale: pressed ? 0.94 : 1 }],
      })}
    >
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ width: 18, height: 2, borderRadius: 1, backgroundColor: palette.porcelain }} />
      ))}
    </Pressable>
  );
}
