/**
 * Skeleton blocks — the shape of a panel that has not arrived yet.
 *
 * DESIGN.md §4 asks for "skeletal shimmer blocks matching panel dimensions —
 * never a spinner", and §7 bans the spinner outright. This is the primitive
 * that pays that off; the compositions live beside the markup they mimic, so
 * the two are edited together and the geometry cannot silently drift.
 *
 * One shared value drives a whole group and each block reads its own slice
 * through `arc` — the same single-animation-per-cluster pattern as the launch
 * screen's tile wave, so a grid ripples rather than pulsing in unison.
 *
 * The sheen is an opacity lift rather than a band translated across the block.
 * Several blocks are percentage-width (the 22% cosmetic swatches), and a real
 * sweep needs the block's pixel width — which would mean an onLayout measure
 * per block to animate a highlight nobody parses at 1.4s a cycle. The ripple
 * that reads is the one ACROSS the blocks, and the stagger already carries it.
 */

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { arc } from "../lib/motion";
import { useFullMotion } from "../lib/useMotion";
import { palette, radius as radiusToken } from "../theme";

const CYCLE_MS = 1400;
/** Fraction of a cycle one block spends lit, and the offset between blocks. */
const SHEEN_SPAN = 0.45;
const STAGGER = 0.07;
/** Peak sheen. Any brighter and a resting block reads as selected, not absent. */
const SHEEN_PEAK = 0.06;

/** Null when the device cannot afford the loop — blocks then render flat. */
const WaveContext = createContext<SharedValue<number> | null>(null);

interface SkeletonGroupProps {
  /** What is loading, for screen readers: "Loading the shop". */
  label: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function SkeletonGroup({ label, children, style }: SkeletonGroupProps) {
  const full = useFullMotion();
  const wave = useSharedValue(0);

  useEffect(() => {
    if (!full) return;
    wave.value = withRepeat(withTiming(1, { duration: CYCLE_MS, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(wave);
  }, [full, wave]);

  return (
    <WaveContext.Provider value={full ? wave : null}>
      {/* `accessible` is what makes the role and label reachable: on iOS a
          plain View is not an accessibility element, and every block inside is
          accessible={false}, so without this VoiceOver has nothing to focus and
          the label never gets read. With it the group is one element saying
          what is loading. */}
      <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={style}>
        {children}
      </View>
    </WaveContext.Provider>
  );
}

interface SkeletonBlockProps {
  width: DimensionValue;
  height: number;
  /** Match the radius of the real thing this stands in for. */
  rad?: number;
  /** Position in the group's wave. Neighbours should differ by one. */
  index?: number;
  style?: StyleProp<ViewStyle>;
}

export function SkeletonBlock({ width, height, rad = radiusToken.sm, index = 0, style }: SkeletonBlockProps) {
  const wave = useContext(WaveContext);
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[
        { width, height, borderRadius: rad, backgroundColor: palette.liftedSlate, overflow: "hidden" },
        style,
      ]}
    >
      {wave ? <Sheen wave={wave} index={index} /> : null}
    </View>
  );
}

function Sheen({ wave, index }: { wave: SharedValue<number>; index: number }) {
  const sheenStyle = useAnimatedStyle(() => ({
    opacity: arc(wave.value, index, SHEEN_SPAN, STAGGER) * SHEEN_PEAK,
  }));
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { backgroundColor: palette.porcelain }, sheenStyle]}
    />
  );
}

/** A block at text-line proportions, for names and captions. */
export function SkeletonLine({
  width,
  index = 0,
  size = 13,
}: {
  width: DimensionValue;
  index?: number;
  /** The font size of the line this replaces. */
  size?: number;
}) {
  // Two heights, and they are answering two different questions.
  //
  // The BAR is shorter than the text it replaces — a full-height bar reads as a
  // filled field rather than an absent line. That is a look decision and it
  // stays.
  //
  // The BOX is the layout one. A 15pt Text does not occupy 15pt; it occupies a
  // line box of roughly 1.3x the font size, so a bare 13pt bar stood in ~6pt
  // short per line and the panel jumped when the real text landed. The bar is
  // centred in a box at the height the line will actually take.
  return (
    <View style={{ height: Math.round(size * 1.3), justifyContent: "center" }}>
      <SkeletonBlock width={width} height={Math.round(size * 0.85)} rad={4} index={index} />
    </View>
  );
}
