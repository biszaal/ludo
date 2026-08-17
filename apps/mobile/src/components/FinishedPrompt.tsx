/**
 * "You're home — stay or go?" — shown to a player the moment they bring their
 * last token in, while the rest of the table is still racing for the minor
 * places.
 *
 * The winner already gets WinnerCelebration. Everyone else used to get nothing:
 * a player who finished 2nd in a four-way game was simply left watching a match
 * they had no stake in, with no offer to leave and no idea whether leaving
 * would cost them the placement they had just earned. It does not — the engine
 * keeps a finished player in `finishedOrder` whether they stay or go, and the
 * server settles the pot when the match ends — so the copy says so plainly.
 *
 * Purely presentational; GameView decides when to mount it.
 */

import { Text, View } from "react-native";
import Animated, { Easing, FadeIn, FadeInDown } from "react-native-reanimated";
import type { Color } from "@ludo/engine";
import { Button } from "./Button";
import { AvatarGlyph } from "./Avatar";
import { CoinGlyph } from "./CoinsPill";
import { useLayout } from "../lib/useLayout";
import { ordinal } from "../lib/standings";
import { font, palette, radius, space, teamColor } from "../theme";

interface FinishedPromptProps {
  /** 1-based finishing place the local seat just took. */
  place: number;
  color: Color;
  avatarId: string | null;
  /** Coins this place pays, 0 for a friendly game. */
  reward: number;
  onWatch: () => void;
  onLeave: () => void;
}

export function FinishedPrompt({ place, color, avatarId, reward, onWatch, onLeave }: FinishedPromptProps) {
  const { maxWidth } = useLayout();

  return (
    <Animated.View
      entering={FadeIn.delay(500).duration(320)}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        // Above the game HUD, below WinnerCelebration (zIndex 50) — if the local
        // player IS the champion, that one speaks for the moment instead.
        zIndex: 45,
        backgroundColor: "rgba(20,23,28,0.93)",
        paddingHorizontal: space.xl,
        justifyContent: "center",
        alignItems: "center",
        gap: space.lg,
      }}
    >
      <Animated.View
        entering={FadeInDown.delay(620).duration(300).easing(Easing.out(Easing.cubic))}
        style={{ alignItems: "center", gap: space.md }}
      >
        {avatarId ? (
          <AvatarGlyph id={avatarId} size={72} />
        ) : (
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: radius.pill,
              backgroundColor: teamColor[color],
              borderWidth: 3,
              borderColor: palette.porcelain,
            }}
          />
        )}
        <Text style={{ fontFamily: font.display, fontSize: 28, color: palette.porcelain, textAlign: "center" }}>
          You finished {ordinal(place)}
        </Text>

        {reward > 0 ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <CoinGlyph size={16} />
            <Text style={{ fontFamily: font.mono, fontSize: 16, color: palette.porcelain }}>+{reward}</Text>
          </View>
        ) : null}

        <Text
          style={{
            fontFamily: font.medium,
            fontSize: 14,
            color: palette.mutedSteel,
            textAlign: "center",
            maxWidth: 300,
          }}
        >
          {reward > 0
            ? "Your place is locked in. The coins land when the match ends — you don't have to stay for them."
            : "Your place is locked in. Stay and watch the rest, or head home."}
        </Text>
      </Animated.View>

      <Animated.View
        entering={FadeIn.delay(900).duration(280)}
        style={{ gap: space.sm, width: "100%", maxWidth, alignSelf: "center" }}
      >
        <Button label="Watch the rest" onPress={onWatch} />
        <Button label="Leave" onPress={onLeave} variant="ghost" />
      </Animated.View>
    </Animated.View>
  );
}
