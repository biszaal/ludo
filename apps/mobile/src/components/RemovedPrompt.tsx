/**
 * "You were removed from this game" — shown to a player who comes back to a
 * match the server took them out of while their app was away.
 *
 * Without it the screen gave no sign anything had happened: the board carried
 * on with the player's own pawns simply gone, and the chat still open, so the
 * one person who most needed telling was left to work it out from the board.
 *
 * Watching stays possible — friends are still playing, and seeing how it ends
 * is a fair reason to stay — but the seat is gone for good, so the choices are
 * watch or go home, never rejoin.
 *
 * Purely presentational; GameView decides when to mount it.
 */

import { Text } from "react-native";
import Animated, { Easing, FadeIn, FadeInDown } from "react-native-reanimated";
import { Button } from "./Button";
import { useLayout } from "../lib/useLayout";
import { font, palette, space } from "../theme";
import { useT } from "../i18n";

interface RemovedPromptProps {
  /** Coins this seat staked, 0 for a friendly game. It stays in the pot. */
  stake: number;
  onWatch: () => void;
  onHome: () => void;
}

export function RemovedPrompt({ stake, onWatch, onHome }: RemovedPromptProps) {
  const t = useT();
  const { maxWidth } = useLayout();

  return (
    <Animated.View
      entering={FadeIn.duration(280)}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        // Same layer as FinishedPrompt: above the game HUD, below
        // WinnerCelebration. A removed seat is never also a finished one.
        zIndex: 45,
        backgroundColor: "rgba(20,23,28,0.93)",
        paddingHorizontal: space.xl,
        justifyContent: "center",
        alignItems: "center",
        gap: space.lg,
      }}
    >
      <Animated.View
        entering={FadeInDown.delay(120).duration(300).easing(Easing.out(Easing.cubic))}
        style={{ alignItems: "center", gap: space.md }}
      >
        <Text style={{ fontFamily: font.display, fontSize: 26, color: palette.porcelain, textAlign: "center" }}>
          {t("game.removedTitle")}
        </Text>
        <Text
          style={{
            fontFamily: font.medium,
            fontSize: 14,
            color: palette.mutedSteel,
            textAlign: "center",
            maxWidth: 300,
          }}
        >
          {t("game.removedBody")}
          {stake > 0 ? ` ${t("game.removedCoins", { coins: stake })}` : ""}
        </Text>
      </Animated.View>

      <Animated.View
        entering={FadeIn.delay(360).duration(280)}
        style={{ gap: space.sm, width: "100%", maxWidth, alignSelf: "center" }}
      >
        <Button label={t("home.home")} onPress={onHome} />
        <Button label={t("game.watchTheRest")} onPress={onWatch} variant="ghost" />
      </Animated.View>
    </Animated.View>
  );
}
