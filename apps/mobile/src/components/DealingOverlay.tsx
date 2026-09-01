/**
 * Covers the board while a table is dealt and the opening die is fetched.
 *
 * The first roll of a game is the one whose die prefetch is least likely to have
 * landed — the request is queued behind everything a fresh game screen starts —
 * so it was reliably the roll that had to wait on the network with a player
 * already tapping at it. The die survives that on its own now (it rolls for as
 * long as the server takes), but handing somebody a die that cannot answer yet
 * is the wrong thing to do in the first place. So the board is covered until it
 * can.
 *
 * Deliberately brief and deliberately honest. It says what is happening rather
 * than inventing a percentage, and it carries the same "working" idiom the
 * launch screen uses — a hairline sweep, no spinner (DESIGN.md bans them) —
 * because this and the launch screen are the same promise to the player.
 *
 * On the reduced motion tier the sweep is not drawn at all, rather than drawn
 * and left standing still: a track that cannot sweep is a deliberate downgrade
 * wearing the costume of a broken screen.
 */

import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useFullMotion } from "../lib/useMotion";
import { font, palette, radius, space } from "../theme";

const TRACK_W = 132;
const SWEEP_W = 46;

export function DealingOverlay() {
  const fullMotion = useFullMotion();
  const x = useSharedValue(-SWEEP_W);

  useEffect(() => {
    if (!fullMotion) return;
    x.value = withRepeat(
      withTiming(TRACK_W, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
      -1,
      false,
    );
    return () => cancelAnimation(x);
  }, [fullMotion, x]);

  const sweepStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View style={styles.fill} pointerEvents="auto" accessibilityLabel="Dealing the table">
      <Text style={styles.label}>Dealing…</Text>
      {fullMotion ? (
        <View style={styles.track}>
          <Animated.View style={[styles.sweep, sweepStyle]} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    // Not fully opaque: the table reads through it, so this is the board being
    // made ready rather than a different screen having replaced it.
    backgroundColor: "rgba(20, 23, 28, 0.82)",
  },
  label: {
    fontFamily: font.display,
    fontSize: 22,
    color: palette.porcelain,
    marginBottom: space.md,
  },
  track: {
    width: TRACK_W,
    height: 3,
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
