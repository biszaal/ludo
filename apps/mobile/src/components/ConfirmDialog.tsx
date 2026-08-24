/**
 * The game's own "are you sure" — a centered card, not the OS alert.
 *
 * Mounted once in App and driven by store/confirmStore; nothing renders this
 * directly. Deliberately NOT built on Sheet.tsx: a bottom sheet is the shell
 * for browsing and buying, where the card is a surface you settle into. A
 * question that blocks a destructive action wants the opposite — it should land
 * in the middle of the screen and interrupt, so it gets its own shell and a
 * short scale-in instead of a slide-up.
 *
 * The affirmative button carries the danger color when the action destroys
 * something, and Cancel is the wide, quiet, easy-to-hit one. Both matter: the
 * dialog exists because a mis-tap already happened once.
 */

import { BackHandler, Pressable, Text, View } from "react-native";
import Animated, { Easing, FadeIn, FadeOut, ZoomIn } from "react-native-reanimated";
import { useEffect } from "react";
import { Button } from "./Button";
import { useLayout } from "../lib/useLayout";
import { useConfirm } from "../store/confirmStore";
import { depth, font, palette, radius, space, teamColor } from "../theme";

export function ConfirmDialog() {
  const request = useConfirm((s) => s.request);
  const answer = useConfirm((s) => s.answer);

  // Android back cancels, like the backdrop. Registered only while the dialog
  // is up so it never swallows a back press meant for the screen behind it.
  useEffect(() => {
    if (!request) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      answer(false);
      return true;
    });
    return () => sub.remove();
  }, [request, answer]);

  const { maxWidth } = useLayout();
  if (!request) return null;

  const { title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", destructive = false, notice = false } = request;

  return (
    <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
      <Animated.View
        entering={FadeIn.duration(140)}
        exiting={FadeOut.duration(140)}
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(20,23,28,0.66)" }}
      >
        {/* A notice has no "no", so the backdrop acknowledges rather than
            cancelling — dismissing it must not read as a refusal. */}
        <Pressable
          accessibilityLabel={notice ? confirmLabel : cancelLabel}
          style={{ flex: 1 }}
          onPress={() => answer(notice)}
        />
      </Animated.View>

      <Animated.View
        accessibilityViewIsModal
        // Scales in from slightly small — reads as the question arriving, where
        // a fade alone would let it look as if it had always been there.
        entering={ZoomIn.duration(170).easing(Easing.out(Easing.cubic))}
        exiting={FadeOut.duration(120)}
        style={{
          width: "86%",
          maxWidth: maxWidth === undefined ? 400 : Math.min(maxWidth, 400),
          backgroundColor: palette.raisedSlate,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: palette.hairline,
          borderTopColor: depth.highlight,
          padding: space.xl,
          gap: space.md,
          shadowColor: "#000",
          shadowOpacity: 0.45,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 10 },
          elevation: 16,
        }}
      >
        <Text style={{ fontFamily: font.display, fontSize: 20, color: palette.porcelain }}>{title}</Text>
        {message ? (
          <Text style={{ fontFamily: font.regular, fontSize: 14, lineHeight: 20, color: palette.mutedSteel }}>
            {message}
          </Text>
        ) : null}

        {/* Cancel first in reading order and in the layout: the way out should
            be the one the eye and the thumb reach first. A notice drops it
            entirely and lets the single button span the card — offering
            "Cancel" against a statement invites a choice that isn't there. */}
        <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.xs }}>
          {notice ? null : (
            <View style={{ flex: 1 }}>
              <Button label={cancelLabel} variant="ghost" onPress={() => answer(false)} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Button
              label={confirmLabel}
              color={destructive ? teamColor.red : palette.porcelain}
              textColor={destructive ? palette.porcelain : palette.feltCharcoal}
              onPress={() => answer(true)}
            />
          </View>
        </View>
      </Animated.View>
    </View>
  );
}
