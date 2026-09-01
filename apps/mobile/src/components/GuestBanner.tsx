/**
 * A standing reminder that a guest account lives on this device only.
 *
 * The passive fourth of the save-account nudges (lib/savePrompt.ts owns the
 * other three). It spends none of that budget, because it interrupts nothing:
 * it is a strip a player can read or ignore, not a dialog they have to answer.
 * That is what makes "ask at four different moments" survivable — three of them
 * are interruptions on a shared cooldown, and this one is furniture.
 *
 * Mounted at the app root rather than inside Home, for the reason InviteBanner
 * is: Home is a no-scroll layout on a measured height budget, and pushing a
 * strip into that column would squeeze the diorama or shove the dock under the
 * fold on small phones. Above the app it costs the layout nothing.
 *
 * Only ever on Home. A banner about account durability during a match is an
 * interruption wearing a banner's clothes, and the results screen is somebody's
 * win — neither is the moment.
 */

import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import { getIdentity } from "../lib/auth";
import { useNav } from "../store/navStore";
import { useProfile } from "../store/profileStore";
import { depth, font, palette, radius, space } from "../theme";

export function GuestBanner() {
  const stack = useNav((s) => s.stack);
  const go = useNav((s) => s.push);
  const [isGuest, setIsGuest] = useState(false);
  const [hidden, setHidden] = useState(false);
  // Re-asked when the player links an account, which is a store write away —
  // the session is the only honest source, and a linked account and a guest
  // have identical wallets.
  const savePromptCount = useProfile((s) => s.savePromptCount);

  const onHome = stack[stack.length - 1]?.name === "home";

  useEffect(() => {
    if (!onHome) return;
    let alive = true;
    void getIdentity()
      .then((id) => {
        if (alive) setIsGuest(id.isGuest);
      })
      .catch(() => {
        // No session yet, or offline. Say nothing rather than warn a player who
        // may well have an account.
      });
    return () => {
      alive = false;
    };
  }, [onHome, savePromptCount]);

  if (!onHome || !isGuest || hidden) return null;

  return (
    <SafeAreaView edges={["bottom"]} style={{ position: "absolute", left: 0, right: 0, bottom: 0 }} pointerEvents="box-none">
      <Animated.View
        entering={FadeInDown.duration(260)}
        exiting={FadeOut.duration(160)}
        style={{
          marginHorizontal: space.lg,
          marginBottom: space.sm,
          paddingVertical: space.sm,
          paddingHorizontal: space.md,
          borderRadius: radius.lg,
          backgroundColor: palette.feltCharcoal,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          ...depth.shadow,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: font.semibold, fontSize: 13, color: palette.porcelain }}>
            Playing as a guest
          </Text>
          <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>
            Your coins and gems live on this phone only.
          </Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => go("account")} hitSlop={8}>
          <Text style={{ fontFamily: font.semibold, fontSize: 13, color: palette.porcelain }}>Save</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          onPress={() => setHidden(true)}
          hitSlop={10}
        >
          <Text style={{ fontFamily: font.regular, fontSize: 16, color: palette.mutedSteel }}>×</Text>
        </Pressable>
      </Animated.View>
    </SafeAreaView>
  );
}
