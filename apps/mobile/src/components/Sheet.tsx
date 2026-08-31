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
import { Pressable, ScrollView, Text, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  ZoomIn,
  ZoomOut,
} from "react-native-reanimated";
import { useLayout } from "../lib/useLayout";
import { useSheetHost } from "../store/sheetHost";
import { depth, font, palette, radius, space } from "../theme";

interface SheetProps {
  onClose: () => void;
  /** Optional header row: title left, drawn × close right. */
  title?: string;
  keyboardAvoiding?: boolean;
  /**
   * How the card is presented.
   *
   * "bottom" (default) is the band that slides up from the bottom edge — right
   * for a sheet you skim and dismiss, and for anything whose content is a long
   * list (the gem store, the daily chest).
   *
   * "popup" is a centered dialog that scales in. Used where the sheet is a
   * short DECISION rather than a browse — picking a table size, typing a room
   * code — because a bottom band pushes that decision down to the thumb line
   * and off the centre of attention, and because a card that is already
   * vertically centred has somewhere to go when the keyboard opens.
   */
  variant?: "bottom" | "popup";
  children: ReactNode;
}

export function Sheet({
  onClose,
  title,
  keyboardAvoiding = false,
  variant = "bottom",
  children,
}: SheetProps) {
  const { isTablet, maxWidth, height, insets } = useLayout();
  const id = useId();
  const present = useSheetHost((s) => s.present);
  const dismiss = useSheetHost((s) => s.dismiss);
  const popup = variant === "popup";
  // Never let the card grow past the top inset; beyond that it scrolls. A popup
  // is centred, so it has to clear BOTH insets rather than just the top one.
  const maxHeight = popup
    ? height - insets.top - insets.bottom - space.xxl
    : height - insets.top - space.xl;

  const card = (
    <Animated.View
      // A popup arrives where it already is, so it scales rather than travels.
      // Sliding a centred card up from the bottom edge reads as a bottom sheet
      // that stopped halfway.
      entering={
        popup
          ? ZoomIn.duration(180).easing(Easing.out(Easing.cubic))
          : SlideInDown.duration(240).easing(Easing.out(Easing.cubic))
      }
      exiting={popup ? ZoomOut.duration(140) : SlideOutDown.duration(180)}
      style={{
        width: "100%",
        maxWidth,
        maxHeight,
        backgroundColor: palette.raisedSlate,
        borderTopLeftRadius: radius.lg,
        borderTopRightRadius: radius.lg,
        // Tablet: a floating modal card (all corners, lifted off the edge).
        // A popup is a floating card on every device, so it rounds all four.
        borderBottomLeftRadius: isTablet || popup ? radius.lg : 0,
        borderBottomRightRadius: isTablet || popup ? radius.lg : 0,
        marginBottom: isTablet && !popup ? insets.bottom + space.xl : 0,
        borderWidth: 1,
        borderColor: palette.hairline,
        borderTopColor: depth.highlight,
        shadowColor: "#000",
        shadowOpacity: 0.4,
        shadowRadius: 16,
        // A popup floats, so its shadow falls straight down rather than being
        // cast upward off a card sitting on the screen's edge.
        shadowOffset: { width: 0, height: popup ? 8 : -6 },
        elevation: 12,
        paddingHorizontal: space.xl,
        paddingTop: space.lg,
        // The host draws this at the app ROOT, outside every SafeAreaView, so
        // nothing else keeps the card off the system bar. On Android's
        // three-button nav that bar sat on top of the last row — the Play
        // button's stake line, the Buy button — so the sheet's own bottom
        // padding has to clear it. The tablet card is already lifted off the
        // edge by marginBottom, so its inset is spent there instead — and a
        // popup never touches the bar at all, so it spends nothing.
        paddingBottom: popup ? space.xl : space.xxl + (isTablet ? 0 : insets.bottom),
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

  /**
   * Where the card sits in the overlay.
   *
   * A bottom sheet pins to the bottom edge and lets its own height decide the
   * rest. A popup fills the overlay and centres in it, which is also what makes
   * it behave under the keyboard: KeyboardAvoidingView adds bottom padding
   * equal to the IME, and a CENTRED card re-centres in what is left — it lifts
   * by half the keyboard rather than the whole of it, which is exactly the
   * behaviour you want for a dialog whose field is near the top.
   */
  const anchor = popup
    ? {
        position: "absolute" as const,
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        // Keeps the card off the screen edges; a bottom sheet spans the full
        // width by design, so this is popup-only.
        paddingHorizontal: space.xl,
      }
    : { position: "absolute" as const, left: 0, right: 0, bottom: 0, alignItems: "center" as const };

  const overlay = (
    <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}>
      <Animated.View
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(160)}
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(20,23,28,0.6)" }}
      >
        <Pressable accessibilityLabel="Close" style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>

      {/* The keyboard-controller KeyboardAvoidingView, with `behavior="padding"`
          on BOTH platforms.

          React Native's own version deliberately takes no behavior on Android:
          the platform recipe was to let `adjustResize` shrink the window and
          let a bottom-anchored card ride up with it. Under the edge-to-edge
          that SDK 56 makes mandatory the window no longer shrinks, so that came
          to mean "do nothing at all" — and this card is `position: absolute;
          bottom: 0`, so it stayed pinned to the physical bottom of the screen
          with the keyboard drawn over it. The friend-code and account fields
          sit in here.

          This implementation reads the IME insets rather than the window size,
          so padding is the correct behavior on Android too, and the card tracks
          the keyboard's animation instead of jumping after it. */}
      {keyboardAvoiding ? (
        <KeyboardAvoidingView behavior="padding" style={anchor} pointerEvents="box-none">
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
