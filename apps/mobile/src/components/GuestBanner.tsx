/**
 * A standing reminder that a guest account lives on this device only.
 *
 * The passive fourth of the save-account nudges (lib/savePrompt.ts owns the
 * other three). It spends none of that budget, because it interrupts nothing:
 * it is a strip a player can read or ignore, not a dialog they have to answer.
 * That is what makes "ask at four different moments" survivable — three of them
 * are interruptions on a shared cooldown, and this one is furniture.
 *
 * Furniture, so it stands in the hub's column with the rest of the furniture.
 * It used to float at the app root anchored to the bottom edge, on the theory
 * that a strip outside Home's measured budget costs the layout nothing. That is
 * only true of a strip with nothing underneath it, and the dock is exactly
 * underneath it — the strip covered the doorways. Home reserves
 * HOME_GUEST_STRIP for it instead, so the budget compresses the tower around
 * the strip and every doorway stays tappable.
 *
 * Only ever on Home, which is why Home is now the only thing that mounts it. A
 * banner about account durability during a match is an interruption wearing a
 * banner's clothes, and the results screen is somebody's win — neither is the
 * moment.
 */

import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { getIdentity } from "../lib/auth";
import { useProfile } from "../store/profileStore";
import { depth, font, palette, radius, space } from "../theme";

/**
 * Dismissal is module-level, not component state, because Home remounts on
 * every return from a match — a flag living in the strip would bring it back
 * after each game, which is not what "×" means. Session-scoped, matching what
 * the app-root mount used to give it for free.
 */
let dismissedThisSession = false;

/**
 * Whether the strip is showing, and the tap that retires it. Home asks before
 * it budgets its column, so the answer has to be available above the strip.
 */
export function useGuestStrip(): { visible: boolean; dismiss: () => void } {
  const [isGuest, setIsGuest] = useState(false);
  const [dismissed, setDismissed] = useState(dismissedThisSession);
  // Re-asked when the player links an account, which is a store write away —
  // the session is the only honest source, and a linked account and a guest
  // have identical wallets.
  const savePromptCount = useProfile((s) => s.savePromptCount);

  useEffect(() => {
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
  }, [savePromptCount]);

  return {
    visible: isGuest && !dismissed,
    dismiss: () => {
      dismissedThisSession = true;
      setDismissed(true);
    },
  };
}

interface GuestBannerProps {
  /** The tier's uiScale, so the strip grows with the furniture around it —
   *  and so HOME_GUEST_STRIP stays an honest reservation on a tablet. */
  scale?: number;
  onSave: () => void;
  onDismiss: () => void;
}

export function GuestBanner({ scale = 1, onSave, onDismiss }: GuestBannerProps) {
  const s = (n: number) => Math.round(n * scale);
  return (
    // Entering only: the strip's block leaves the column the moment it is
    // dismissed, so there is no parent left for an exit to play inside.
    <Animated.View
      entering={FadeInDown.duration(260)}
      style={{
        paddingVertical: s(space.sm),
        paddingHorizontal: s(space.md),
        borderRadius: radius.lg,
        backgroundColor: palette.feltCharcoal,
        flexDirection: "row",
        alignItems: "center",
        gap: s(space.sm),
        ...depth.shadow,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: font.semibold, fontSize: s(13), color: palette.porcelain }}>
          Playing as a guest
        </Text>
        <Text style={{ fontFamily: font.regular, fontSize: s(12), color: palette.mutedSteel }}>
          Your coins and gems live on this phone only.
        </Text>
      </View>
      <Pressable accessibilityRole="button" onPress={onSave} hitSlop={8}>
        <Text style={{ fontFamily: font.semibold, fontSize: s(13), color: palette.porcelain }}>Save</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        onPress={onDismiss}
        hitSlop={10}
      >
        <Text style={{ fontFamily: font.regular, fontSize: s(16), color: palette.mutedSteel }}>×</Text>
      </Pressable>
    </Animated.View>
  );
}
