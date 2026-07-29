/**
 * Launch screen — covers the app while fonts load, then crossfades off the top
 * of the mounted UI.
 *
 * Deliberately textless: the custom fonts are the very thing being waited on,
 * so any copy here would paint in the system face and snap the moment Outfit
 * lands. The four wordmark tiles carry it instead, hopping in a staggered wave
 * — the same arc tokens travel on the board (DESIGN.md §6), so the app's motion
 * idiom is the first thing you see. Each tile's shadow tightens as it lifts,
 * which is what sells them as physical pieces rather than moving rectangles.
 *
 * No spinner (banned) and no percentage: font loading has no honest progress to
 * report, so the hairline sweep says "working" without inventing a number.
 */

import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { TableBackground } from "./TableBackground";
import { arc } from "../lib/motion";
import { palette, radius, teamColor } from "../theme";
import type { Color as PlayerColor } from "@ludo/engine";

/** Wordmark order and rest tilts, matched to <Logo> so the handoff to Home
 *  reads as the same four objects settling rather than a different screen. */
const TILES: { color: PlayerColor; tilt: number }[] = [
  { color: "red", tilt: -6 },
  { color: "green", tilt: 4 },
  { color: "yellow", tilt: -4 },
  { color: "blue", tilt: 6 },
];

const TILE = 52;
const HOP_RISE = 26;
/** Fraction of one cycle a tile spends airborne, and the offset between tiles.
 *  Four tiles at 0.13 leaves a beat of stillness before the wave restarts. */
const HOP_SPAN = 0.42;
const STAGGER = 0.13;
const CYCLE_MS = 1600;

const SWEEP_W = 46;
const TRACK_W = 132;

/** Held on screen this long even if fonts resolve instantly — a sub-100ms flash
 *  of brand reads as a glitch, not a launch. */
const MIN_VISIBLE_MS = 650;
const FADE_MS = 320;

interface LoadingScreenProps {
  /** Flips true once the app behind this screen is ready to be seen. */
  done: boolean;
  /** Fired after the fade completes, so the caller can unmount this. */
  onHidden: () => void;
}

export function LoadingScreen({ done, onHidden }: LoadingScreenProps) {
  const wave = useSharedValue(0);
  const sweep = useSharedValue(0);
  const fade = useSharedValue(1);
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    wave.value = withRepeat(withTiming(1, { duration: CYCLE_MS, easing: Easing.linear }), -1, false);
    sweep.value = withRepeat(withTiming(1, { duration: 1150, easing: Easing.inOut(Easing.ease) }), -1, false);
    return () => {
      cancelAnimation(wave);
      cancelAnimation(sweep);
    };
  }, [wave, sweep]);

  useEffect(() => {
    if (!done) return;
    const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - mountedAt.current));
    const timer = setTimeout(() => {
      fade.value = withTiming(0, { duration: FADE_MS }, (finished) => {
        if (finished) runOnJS(onHidden)();
      });
    }, wait);
    return () => clearTimeout(timer);
  }, [done, fade, onHidden]);

  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -SWEEP_W + sweep.value * (TRACK_W + SWEEP_W) }],
  }));

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.root, fadeStyle]}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading Ludo"
      // The app mounts underneath mid-fade; swallow taps until we're gone.
      pointerEvents="auto"
    >
      <TableBackground />

      <View style={styles.center}>
        <View style={styles.row}>
          {TILES.map((t, i) => (
            <HopTile key={t.color} color={teamColor[t.color]} tilt={t.tilt} index={i} wave={wave} />
          ))}
        </View>

        <View style={styles.track}>
          <Animated.View style={[styles.sweep, sweepStyle]} />
        </View>
      </View>
    </Animated.View>
  );
}

function HopTile({
  color,
  tilt,
  index,
  wave,
}: {
  color: string;
  tilt: number;
  index: number;
  wave: SharedValue<number>;
}) {
  const tileStyle = useAnimatedStyle(() => {
    const a = arc(wave.value, index, HOP_SPAN, STAGGER);
    return {
      transform: [
        { translateY: -a * HOP_RISE },
        { scale: 1 + a * 0.08 },
        { rotate: `${tilt + a * 5}deg` },
      ],
    };
  });

  // Contact shadow, lit from above: tight and dark when the tile is resting on
  // the felt, spreading and washing out as it climbs. Two stacked ellipses stand
  // in for a blur — RN can't blur a view cheaply, and a single hard-edged slab
  // reads as an underline rather than a shadow.
  const shadowOuterStyle = useAnimatedStyle(() => {
    const a = arc(wave.value, index, HOP_SPAN, STAGGER);
    return { opacity: 0.15 - a * 0.1, transform: [{ scale: 1 + a * 0.35 }] };
  });
  const shadowInnerStyle = useAnimatedStyle(() => {
    const a = arc(wave.value, index, HOP_SPAN, STAGGER);
    return { opacity: 0.26 - a * 0.19, transform: [{ scale: 1 + a * 0.25 }] };
  });

  return (
    <View style={styles.slot}>
      <Animated.View style={[styles.shadowOuter, shadowOuterStyle]} />
      <Animated.View style={[styles.shadowInner, shadowInnerStyle]} />
      <Animated.View style={[styles.tile, { backgroundColor: color }, tileStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: palette.tableBlue,
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    alignItems: "center",
    // Sits a touch above true center; dead-centered reads as a static splash.
    marginTop: -40,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  slot: {
    // Wide enough that a tilted tile at apex scale never clips its neighbour.
    width: TILE + 14,
    height: TILE + HOP_RISE + 12,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: TILE * 0.26,
    // Small enough that a resting tile reads as sitting on the felt, not
    // hovering over its own shadow.
    marginBottom: 5,
    borderBottomWidth: 4,
    borderBottomColor: "rgba(0,0,0,0.22)",
  },
  shadowOuter: {
    position: "absolute",
    bottom: 0,
    width: TILE * 0.94,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: palette.feltCharcoal,
  },
  shadowInner: {
    position: "absolute",
    bottom: 2,
    width: TILE * 0.6,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: palette.feltCharcoal,
  },
  track: {
    width: TRACK_W,
    height: 3,
    marginTop: 34,
    borderRadius: radius.pill,
    backgroundColor: palette.hairline,
    overflow: "hidden",
  },
  sweep: {
    width: SWEEP_W,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: palette.porcelain,
    opacity: 0.55,
  },
});
