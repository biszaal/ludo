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
 */

import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { Easing, FadeIn, FadeOut, SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useLayout } from "../lib/useLayout";
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
        paddingBottom: space.xxl,
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

  return (
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
