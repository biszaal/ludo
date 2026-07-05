/**
 * Full-screen results shown while state.status === "finished". Fades in after a
 * beat so the winning move finishes on the board first. Winner block up top,
 * ranked rows, then Rematch/Home in the thumb zone. Confetti bursts once in the
 * winner's color + Porcelain + a tint.
 */

import { Text, View, useWindowDimensions } from "react-native";
import Animated, { Easing, FadeIn, FadeInDown } from "react-native-reanimated";
import type { GameState } from "@ludo/engine";
import { Button } from "./Button";
import { Confetti } from "./Confetti";
import { AvatarGlyph } from "./Avatar";
import { Surface3D } from "./Surface3D";
import { computeStandings } from "../lib/standings";
import { font, palette, radius, space, teamColor, teamTint } from "../theme";

const COLOR_LABEL = { red: "Red", green: "Green", yellow: "Yellow", blue: "Blue" } as const;

interface ResultsOverlayProps {
  state: GameState;
  /** Display name for a seat; defaults to the color label. */
  nameFor?: (playerId: string) => string | null;
  /** Avatar id for a seat (null → color chip). */
  avatarFor?: (playerId: string) => string | null;
  /** Hidden when undefined (e.g. online guest until the host rematches). */
  onRematch?: () => void;
  /** Shown under the buttons (e.g. "Waiting for the host…"). */
  footnote?: string | null;
  onHome: () => void;
}

export function ResultsOverlay({ state, nameFor, avatarFor, onRematch, footnote, onHome }: ResultsOverlayProps) {
  const { width, height } = useWindowDimensions();
  const standings = computeStandings(state);
  const winner = standings[0]!;
  const winnerName = nameFor?.(winner.playerId) ?? COLOR_LABEL[winner.color];
  const winnerAvatar = avatarFor?.(winner.playerId) ?? null;

  return (
    <Animated.View
      entering={FadeIn.delay(900).duration(450)}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        backgroundColor: "rgba(20,23,28,0.94)",
        paddingHorizontal: space.xl,
        justifyContent: "space-between",
      }}
    >
      <Confetti
        width={width}
        height={height}
        originX={width / 2}
        originY={height * 0.3}
        colors={[teamColor[winner.color], palette.porcelain, teamTint[winner.color]]}
      />

      {/* Winner block */}
      <Animated.View entering={FadeInDown.delay(1050).duration(320).easing(Easing.out(Easing.cubic))} style={{ alignItems: "center", marginTop: height * 0.14, gap: space.md }}>
        {winnerAvatar ? (
          <AvatarGlyph id={winnerAvatar} size={72} />
        ) : (
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: radius.pill,
              backgroundColor: teamColor[winner.color],
              borderWidth: 3,
              borderColor: palette.porcelain,
            }}
          />
        )}
        <Text style={{ fontFamily: font.display, fontSize: 26, color: palette.porcelain }}>{winnerName}</Text>
        <Text style={{ fontFamily: font.medium, fontSize: 15, color: palette.mutedSteel }}>wins the game</Text>
      </Animated.View>

      {/* Ranked rows (2nd onward) */}
      <View style={{ gap: space.sm }}>
        {standings.slice(1).map((s) => (
          <Surface3D
            key={s.playerId}
            edge={2}
            faceStyle={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              paddingVertical: space.sm,
              paddingHorizontal: space.md,
            }}
          >
            <Text style={{ fontFamily: font.mono, fontSize: 14, color: palette.mutedSteel, width: 22 }}>{s.rank}</Text>
            <View style={{ width: 12, height: 12, borderRadius: radius.pill, backgroundColor: teamColor[s.color] }} />
            <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 15, color: palette.porcelain }}>
              {nameFor?.(s.playerId) ?? COLOR_LABEL[s.color]}
            </Text>
            <Text style={{ fontFamily: font.mono, fontSize: 13, color: palette.mutedSteel }}>{s.finished}/4</Text>
          </Surface3D>
        ))}
      </View>

      {/* Actions */}
      <View style={{ gap: space.sm, marginBottom: space.xxl }}>
        {onRematch ? <Button label="Rematch" onPress={onRematch} /> : null}
        <Button label="Home" onPress={onHome} variant="ghost" />
        {footnote ? (
          <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel, textAlign: "center" }}>{footnote}</Text>
        ) : null}
      </View>
    </Animated.View>
  );
}
