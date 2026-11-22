/**
 * The reward wheel. Wedges are drawn in Skia; each prize label is a plain view
 * laid over its wedge, so the amounts use the app's fonts and glyphs without
 * loading a font into Skia. Wedges and labels sit in one animated view and turn
 * together by `rotation` (degrees, clockwise). The pointer stays fixed at the
 * top.
 *
 * Segment 0 is centred under the pointer at rotation 0, segments run
 * clockwise — the convention wheelTarget (lib/spin) solves for.
 *
 * Colours are chrome only (DESIGN.md §2: the four team colours are board-only).
 */

import { useMemo } from "react";
import { Text, View } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { Canvas, Circle, Path, Skia } from "@shopify/react-native-skia";
import { CoinGlyph } from "./CoinsPill";
import { GemGlyph } from "./GemGlyph";
import { formatCompact } from "../lib/format";
import type { Segment } from "../lib/spin";
import { font, palette } from "../theme";

const RIM = "#C8951B";
const POINTER = "#F5C542";
const POINTER_W = 22;
const POINTER_H = 20;
const LABEL_W = 56;
const LABEL_H = 36;

interface SpinWheelProps {
  segments: Segment[];
  rotation: SharedValue<number>;
  size: number;
}

export function SpinWheel({ segments, rotation, size }: SpinWheelProps) {
  const r = size / 2;
  const count = Math.max(1, segments.length);
  const step = 360 / count;

  const wedges = useMemo(() => {
    const oval = Skia.XYWHRect(5, 5, size - 10, size - 10);
    return Array.from({ length: count }, (_, i) =>
      Skia.PathBuilder.Make()
        .moveTo(r, r)
        // Skia measures from 3 o'clock, clockwise; the top is -90°.
        .arcToOval(oval, -90 + i * step - step / 2, step, false)
        .close()
        .detach(),
    );
  }, [count, r, size, step]);

  const pointer = useMemo(
    () =>
      Skia.PathBuilder.Make()
        .moveTo(r - POINTER_W / 2, 0)
        .lineTo(r + POINTER_W / 2, 0)
        .lineTo(r, POINTER_H)
        .close()
        .detach(),
    [r],
  );

  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));

  // Odd wheels would put two equal shades side by side where the last wedge
  // meets the first; the last one takes the deepest neutral instead.
  const shade = (i: number) =>
    count % 2 === 1 && i === count - 1 ? palette.feltCharcoal : i % 2 === 0 ? palette.raisedSlate : palette.liftedSlate;

  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[{ width: size, height: size }, spin]}>
        <Canvas style={{ width: size, height: size }}>
          <Circle cx={r} cy={r} r={r} color={RIM} />
          {wedges.map((p, i) => (
            <Path key={i} path={p} color={shade(i)} />
          ))}
          <Circle cx={r} cy={r} r={r * 0.15} color={palette.feltCharcoal} />
          <Circle cx={r} cy={r} r={r * 0.15} color={RIM} style="stroke" strokeWidth={3} />
        </Canvas>
        {segments.map((s, i) => {
          const angle = ((-90 + i * step) * Math.PI) / 180;
          const at = r * 0.66;
          return (
            <View
              key={i}
              style={{
                position: "absolute",
                width: LABEL_W,
                height: LABEL_H,
                left: r + at * Math.cos(angle) - LABEL_W / 2,
                top: r + at * Math.sin(angle) - LABEL_H / 2,
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
                transform: [{ rotate: `${i * step}deg` }],
              }}
            >
              {"gems" in s ? <GemGlyph size={13} /> : <CoinGlyph size={13} />}
              <Text style={{ fontFamily: font.mono, fontSize: 12, color: palette.porcelain }}>
                {"gems" in s ? s.gems : formatCompact(s.coins)}
              </Text>
            </View>
          );
        })}
      </Animated.View>
      <Canvas style={{ position: "absolute", top: -4, left: 0, width: size, height: POINTER_H + 4 }} pointerEvents="none">
        <Path path={pointer} color={POINTER} />
      </Canvas>
    </View>
  );
}
