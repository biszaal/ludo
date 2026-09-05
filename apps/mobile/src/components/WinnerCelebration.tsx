/**
 * Full-screen celebration the moment the game's champion is decided (the first
 * player to bring all four tokens home). Confetti in the winner's color, the
 * winner front and center, then the choice the moment calls for:
 * - game still running (3–4 players): go straight to the standings, stay to
 *   watch the minor places play out, or leave for home. Only a seat that has
 *   finished sees this — GameView keeps it away from anyone still racing, who
 *   must not be interrupted mid-turn;
 * - game over (2 players, or the last finish): on to the results leaderboard.
 * Purely presentational — GameView decides when to mount it.
 */

import { Text, View, useWindowDimensions } from "react-native";
import Animated, { Easing, FadeIn, FadeInDown, withDelay, withRepeat, withSequence, withTiming, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useEffect } from "react";
import { useFullMotion } from "../lib/useMotion";
import type { Color } from "@ludo/engine";
import { Button } from "./Button";
import { Confetti } from "./Confetti";
import { AvatarGlyph } from "./Avatar";
import { useLayout } from "../lib/useLayout";
import { font, palette, radius, space, teamColor, teamTint } from "../theme";

interface WinnerCelebrationProps {
  winnerName: string;
  winnerColor: Color;
  winnerAvatar: string | null;
  /** The game already ended — the only way forward is the results leaderboard. */
  gameOver: boolean;
  /** Match still running: open the standings now rather than waiting the rest
   *  of it out. Unused on game over, where `onStay` already goes there. */
  onSeeResults?: () => void;
  /** Staked pot the winner just took (0 = friendly game). */
  pot: number;
  /** Stay in the room (dismiss; on game over this reveals the results). */
  onStay: () => void;
  onLeave: () => void;
}

export function WinnerCelebration({ winnerName, winnerColor, winnerAvatar, gameOver, onSeeResults, pot, onStay, onLeave }: WinnerCelebrationProps) {
  const { width, height } = useWindowDimensions();
  const { maxWidth } = useLayout();

  return (
    <Animated.View
      entering={FadeIn.delay(700).duration(400)}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        // Above the game HUD (the corner-chip rows carry zIndex for bubbles).
        zIndex: 50,
        backgroundColor: "rgba(20,23,28,0.93)",
        paddingHorizontal: space.xl,
        justifyContent: "space-between",
      }}
    >
      <Confetti
        width={width}
        height={height}
        originX={width / 2}
        originY={height * 0.28}
        colors={[teamColor[winnerColor], palette.porcelain, teamTint[winnerColor], "#F5C542"]}
      />

      {/* Winner block */}
      <Animated.View
        entering={FadeInDown.delay(850).duration(320).easing(Easing.out(Easing.cubic))}
        style={{ alignItems: "center", marginTop: height * 0.16, gap: space.md }}
      >
        <CrownedAvatar color={winnerColor} avatarId={winnerAvatar} />
        <View
          style={{
            paddingHorizontal: space.lg,
            paddingVertical: 4,
            borderRadius: radius.pill,
            backgroundColor: "#F5C542",
          }}
        >
          <Text style={{ fontFamily: font.semibold, fontSize: 13, letterSpacing: 2, color: palette.feltCharcoal }}>WINNER</Text>
        </View>
        <Text style={{ fontFamily: font.display, fontSize: 30, color: palette.porcelain, textAlign: "center" }} numberOfLines={1}>
          {winnerName}
        </Text>
        <Text style={{ fontFamily: font.medium, fontSize: 15, color: palette.mutedSteel, textAlign: "center" }}>
          {pot > 0 ? `takes 1st place and the pot — +${pot} coins` : "takes 1st place!"}
        </Text>
      </Animated.View>

      {/* The choice: stay for the rest, or head home. */}
      <Animated.View entering={FadeIn.delay(1400).duration(300)} style={{ gap: space.sm, marginBottom: space.xxl, width: "100%", maxWidth, alignSelf: "center" }}>
        {gameOver ? (
          <Button label="See results" onPress={onStay} />
        ) : (
          <>
            {onSeeResults ? <Button label="See standings" onPress={onSeeResults} /> : null}
            <Button label="Watch the rest" onPress={onStay} variant={onSeeResults ? "ghost" : "fill"} />
            <Button label="Leave" onPress={onLeave} variant="ghost" />
          </>
        )}
      </Animated.View>
    </Animated.View>
  );
}

/** The winner's avatar with a gently bobbing crown on top (drawn, no emoji). */
function CrownedAvatar({ color, avatarId }: { color: Color; avatarId: string | null }) {
  const fullMotion = useFullMotion();
  const bob = useSharedValue(0);
  useEffect(() => {
    if (!fullMotion) {
      // Settle the crown rather than bobbing it, the same way PlayerChip's
      // Breathe holds at the bright end. This loop has no end and the sheet
      // waits on a tap, so a player who sets it down and walks away leaves an
      // unbounded animation asking a weak phone for frames indefinitely. The
      // crown still sits on the winner's head, which is the whole point of it.
      bob.value = withDelay(1100, withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) }));
      return;
    }
    bob.value = withDelay(
      1100,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
      ),
    );
  }, [bob, fullMotion]);
  const crownStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -bob.value * 4 }] }));

  return (
    <View style={{ alignItems: "center" }}>
      <Animated.View style={[{ marginBottom: 6, zIndex: 1 }, crownStyle]}>
        <Crown />
      </Animated.View>
      {avatarId ? (
        <AvatarGlyph id={avatarId} size={84} />
      ) : (
        <View
          style={{
            width: 84,
            height: 84,
            borderRadius: radius.pill,
            backgroundColor: teamColor[color],
            borderWidth: 3,
            borderColor: palette.porcelain,
          }}
        />
      )}
    </View>
  );
}

/** A simple three-point gold crown built from views (no icon fonts). */
function Crown() {
  const gold = "#F5C542";
  const spike = {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderBottomWidth: 14,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: gold,
  } as const;
  return (
    <View style={{ alignItems: "center" }}>
      <View style={{ flexDirection: "row", gap: 2 }}>
        <View style={spike} />
        <View style={[spike, { borderBottomWidth: 18, borderLeftWidth: 8, borderRightWidth: 8, marginTop: -4 }]} />
        <View style={spike} />
      </View>
      <View style={{ width: 46, height: 7, borderRadius: 2, backgroundColor: gold, marginTop: -1 }} />
    </View>
  );
}
