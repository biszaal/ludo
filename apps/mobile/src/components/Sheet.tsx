/**
 * The canonical bottom-sheet shell: dim backdrop (tap to close) + a raised
 * slate card sliding up. Every overlay (BuySheet, GetCoinsSheet, RoomSheet,
 * PlaySetupSheet, …) rides this so timing/styling can't drift. Pass
 * `keyboardAvoiding` when the card hosts a TextInput.
 *
 * The card is height-bounded (screen − top inset) and scrolls internally, so a
 * tall sheet — the gem store, or Play-setup with house rules expanded — can
 * never clip off the top of a short screen. On tablets it becomes a centered,
 * all-corners-rounded modal card instead of a full-width bottom band.
 *
 * It does NOT draw where it is written. React Native has no `position: fixed`,
 * so an absolutely positioned overlay is laid out against its parent's box —
 * and sheets are written next to the state that opens them, which for the
 * Shop's buy sheet is halfway down a scroll view. Anchored there, the card
 * pinned itself to the bottom of the scrolling column instead of the screen, so
 * confirming a purchase meant scrolling down to find the button (with the tab
 * dock painting over the rest of it). Instead the card is published to
 * store/sheetHost and drawn by the one SheetHost at the app root, above the
 * screens and the dock. Call sites are unchanged: mount a Sheet and it lands on
 * the screen, wherever it was declared.
 */

import { useEffect, useId, useLayoutEffect, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { Easing, FadeIn, FadeOut, SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useLayout } from "../lib/useLayout";
import { useSheetHost } from "../store/sheetHost";
import { depth, font, palette, radius, space } from "../theme";

interface SheetProps {
  onClose: () => void;
  /** Optional header row: title left, drawn × close right. */
  title?: string;
  keyboardAvoiding?: boolean;
  children: ReactNode;
}

export function Sheet({ onClose, title, keyboardAvoiding = false, children }: SheetProps) {
  const { isTablet, maxWidth, height, insets } = useLayout();
  const id = useId();
  const present = useSheetHost((s) => s.present);
  const dismiss = useSheetHost((s) => s.dismiss);
  // Never let the card grow past the top inset; beyond that it scrolls.
  const maxHeight = height - insets.top - space.xl;

  const card = (
    <Animated.View
      entering={SlideInDown.duration(240).easing(Easing.out(Easing.cubic))}
      exiting={SlideOutDown.duration(180)}
      style={{
        width: "100%",
        maxWidth,
        maxHeight,
        backgroundColor: palette.raisedSlate,
        borderTopLeftRadius: radius.lg,
        borderTopRightRadius: radius.lg,
        // Tablet: a floating modal card (all corners, lifted off the edge).
        borderBottomLeftRadius: isTablet ? radius.lg : 0,
        borderBottomRightRadius: isTablet ? radius.lg : 0,
        marginBottom: isTablet ? insets.bottom + space.xl : 0,
        borderWidth: 1,
        borderColor: palette.hairline,
        borderTopColor: depth.highlight,
        shadowColor: "#000",
        shadowOpacity: 0.4,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: -6 },
        elevation: 12,
        paddingHorizontal: space.xl,
        paddingTop: space.lg,
        // The host draws this at the app ROOT, outside every SafeAreaView, so
        // nothing else keeps the card off the system bar. On Android's
        // three-button nav that bar sat on top of the last row — the Play
        // button's stake line, the Buy button — so the sheet's own bottom
        // padding has to clear it. The tablet card is already lifted off the
        // edge by marginBottom, so its inset is spent there instead.
        paddingBottom: space.xxl + (isTablet ? 0 : insets.bottom),
        gap: space.md,
      }}
    >
      {title !== undefined && (
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontFamily: font.display, fontSize: 20, color: palette.porcelain }}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8}>
            <CloseGlyph size={16} />
          </Pressable>
        </View>
      )}
      {/* flexShrink lets the scroller yield to the card's maxHeight and take
          over — without it the content would push past the cap and clip. */}
      <ScrollView
        style={{ flexShrink: 1 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: space.md }}
      >
        {children}
      </ScrollView>
    </Animated.View>
  );

  const anchor = { position: "absolute" as const, left: 0, right: 0, bottom: 0, alignItems: "center" as const };

  const overlay = (
    <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}>
      <Animated.View
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(160)}
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(20,23,28,0.6)" }}
      >
        <Pressable accessibilityLabel="Close" style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>

      {keyboardAvoiding ? (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={anchor} pointerEvents="box-none">
          {card}
        </KeyboardAvoidingView>
      ) : (
        <View style={anchor} pointerEvents="box-none">
          {card}
        </View>
      )}
    </View>
  );

  // Republished on every render — the card is a snapshot of this render's
  // props, so a live sheet (buying…, an error, a changed balance) only stays
  // current if the host gets the new one. Before paint, so the sheet never
  // shows a frame of stale content.
  useLayoutEffect(() => {
    present(id, overlay);
  });

  // Unmounting the Sheet takes the card down — and because the HOST stays
  // mounted, removing it from that list is a real unmount, so the slide-out
  // still plays.
  useEffect(() => () => dismiss(id), [id, dismiss]);

  return null;
}

/** Drawn × — sheet closes must not use text glyphs. */
function CloseGlyph({ size }: { size: number }) {
  const s = size;
  const bar = (rot: string) => ({
    position: "absolute" as const,
    left: 0,
    right: 0,
    top: s / 2 - 1,
    height: 2,
    borderRadius: 1,
    backgroundColor: palette.mutedSteel,
    transform: [{ rotate: rot }],
  });
  return (
    <View style={{ width: s, height: s }}>
      <View style={bar("45deg")} />
      <View style={bar("-45deg")} />
    </View>
  );
}
