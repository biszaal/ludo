/**
 * The reward wheel (design: Claude Design canvas "Ludo spin wheel redesign").
 *
 * Three layers, so only the face turns:
 *   1. a fixed base: soft shadow, a metal rim whose metal names the wheel
 *      (bronze, silver, gold; the first-game wheel is gold with every bulb lit)
 *      and a ring of bulbs;
 *   2. the face, which rotates by `rotation` (degrees, clockwise): ivory and
 *      navy wedges with the top coin prize in gold, gold dividers and pegs, and
 *      each prize as a plain view laid over its wedge so the amounts use the
 *      app's fonts and glyphs;
 *   3. a fixed top: the lacquer sheen and edge shading (they belong to the
 *      light, not the wheel), the metal hub with the board's star.
 * The pointer is plain views on top, so it can never fail to paint.
 *
 * Segment 0 is centred under the pointer at rotation 0 and segments run
 * clockwise — the convention wheelTarget (lib/spin) solves for. Colours are
 * chrome and metal only; the four team colours stay on the board (DESIGN.md §2).
 */

import { useEffect, useMemo } from "react";
import { Text, View } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { Canvas, Circle, Group, Line, LinearGradient, Path, RadialGradient, Skia, vec } from "@shopify/react-native-skia";
import { CoinGlyph } from "./CoinsPill";
import { GemGlyph } from "./GemGlyph";
import { formatExact } from "../lib/format";
import { flapperTilt, rimMetal, wedgeFills, type RimMetal, type Segment, type WedgeFill } from "../lib/spin";
import { useFullMotion } from "../lib/useMotion";
import { font, palette } from "../theme";

const METALS: Record<RimMetal, { stops: string[]; off: string }> = {
  bronze: { stops: ["#F6D2AE", "#D08E57", "#8E5530", "#E7AE7E", "#9C6038"], off: "#7A4A2A" },
  silver: { stops: ["#FFFFFF", "#CDD3DB", "#8E959F", "#EEF1F4", "#9AA1AB"], off: "#6E747D" },
  gold: { stops: ["#FFF3C4", "#F5C542", "#A8740F", "#FFE08A", "#B8841C"], off: "#8A5F12" },
};
const METAL_POSITIONS = [0, 0.28, 0.58, 0.82, 1];

const FILL: Record<WedgeFill, string> = { ivory: "#EFE9DA", navy: "#263A78", gold: "#E8B43A" };
const INK: Record<WedgeFill, string> = { ivory: "#16203F", navy: "#F4EFE2", gold: "#3A2706" };

const BULBS = 16;
const STAR = "M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z";

interface SpinWheelProps {
  segments: Segment[];
  /** The server's wheel name: bronze | silver | gold | firstGame. Picks the rim. */
  wheel: string;
  rotation: SharedValue<number>;
  size: number;
  /** The wedge that just won (it glows), or null. */
  highlight?: number | null;
  /** True while the wheel is turning: the bulbs chase faster. */
  spinning?: boolean;
  /** Called each time a peg passes the pointer (ticks, haptics). */
  onPegPass?: () => void;
}

export function SpinWheel({ segments, wheel, rotation, size, highlight = null, spinning = false, onPegPass }: SpinWheelProps) {
  const S = size;
  const R = S / 2;
  const rimT = S * 0.075;
  const face = S - rimT * 2;
  const half = face / 2;
  const count = Math.max(1, segments.length);
  const step = 360 / count;
  const metal = METALS[rimMetal(wheel)];
  const allLit = wheel === "firstGame";
  const fills = useMemo(() => wedgeFills(segments), [segments]);

  const wedges = useMemo(() => {
    const oval = Skia.XYWHRect(0, 0, face, face);
    return Array.from({ length: count }, (_, i) =>
      Skia.PathBuilder.Make()
        .moveTo(half, half)
        // Skia measures from 3 o'clock, clockwise; the top is -90°.
        .arcToOval(oval, -90 + i * step - step / 2, step, false)
        .close()
        .detach(),
    );
  }, [count, face, half, step]);

  const star = useMemo(() => Skia.Path.MakeFromSVGString(STAR), []);
  const starSize = S * 0.2 * 0.42;

  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));
  const full = useFullMotion();
  const pointer = S * 0.12;
  const pointerPivot = pointer * 0.12;

  // Bulbs chase: the even and odd halves cross-fade, slowly at rest and
  // quickly while the wheel turns. Still (alternate lit) under reduced motion.
  const chase = useSharedValue(1);
  useEffect(() => {
    if (!full || allLit) {
      chase.value = 1;
      return;
    }
    chase.value = 0;
    chase.value = withRepeat(withTiming(1, { duration: spinning ? 220 : 900, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [full, allLit, spinning, chase]);
  const evenLit = useDerivedValue(() => (allLit ? 1 : chase.value));
  const oddLit = useDerivedValue(() => (allLit ? 1 : 1 - chase.value));

  // The winning wedge flashes a few times, then keeps a soft glow.
  const glow = useSharedValue(0);
  useEffect(() => {
    if (highlight === null) {
      glow.value = 0;
      return;
    }
    glow.value = full
      ? withSequence(
          withTiming(0.45, { duration: 180 }),
          withRepeat(withSequence(withTiming(0.12, { duration: 380 }), withTiming(0.4, { duration: 380 })), 3, false),
          withTiming(0.22, { duration: 300 }),
        )
      : 0.25;
  }, [highlight, full, glow]);

  // The pointer leans as each peg passes under it (see flapperTilt), swinging
  // about its jewel.
  const pointerSwing = useAnimatedStyle(() => {
    const tilt = flapperTilt(rotation.value, count);
    return { transform: [{ translateY: -pointerPivot }, { rotate: `${tilt}deg` }, { translateY: pointerPivot }] };
  });

  // One tick per peg: the caller turns it into a click and a light haptic.
  useAnimatedReaction(
    () => Math.floor((rotation.value + step / 2) / step),
    (current, previous) => {
      if (previous !== null && current !== previous && onPegPass) runOnJS(onPegPass)();
    },
    [step, onPegPass],
  );

  const bulbR = R - rimT / 2;
  const bulbD = Math.max(3, S * 0.027);
  const pegD = Math.max(3, S * 0.022);
  const pegR = half - pegD * 1.4;
  const hub = S * 0.2;
  const labelW = Math.round(S * 0.22);
  const icon = Math.max(8, Math.round(S * 0.05));
  const num = Math.max(9, Math.round(S * 0.054));
  const labelR = half * 0.66;
  const at = (radius: number, deg: number) => {
    const a = (deg * Math.PI) / 180;
    return { x: R + radius * Math.sin(a), y: R - radius * Math.cos(a) };
  };

  return (
    <View style={{ width: S, height: S }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* 1. Base: shadow, metal rim, bulbs. */}
      <Canvas style={{ position: "absolute", left: 0, top: 0, width: S, height: S }}>
        <Circle cx={R} cy={R + S * 0.03} r={R}>
          <RadialGradient c={vec(R, R + S * 0.04)} r={R * 1.02} colors={["rgba(6,8,12,0.55)", "rgba(6,8,12,0)"]} positions={[0.82, 1]} />
        </Circle>
        <Circle cx={R} cy={R} r={R}>
          <LinearGradient start={vec(0, 0)} end={vec(S, S)} colors={metal.stops} positions={METAL_POSITIONS} />
        </Circle>
        <Circle cx={R} cy={R} r={R - 1} style="stroke" strokeWidth={1.5} color="rgba(255,255,255,0.45)" />
        <Circle cx={R} cy={R} r={half + Math.max(1, S * 0.012)} color="#2A1D06" />
        {Array.from({ length: BULBS }, (_, i) => {
          const { x, y } = at(bulbR, (i * 360) / BULBS);
          return (
            <Circle key={`off${i}`} cx={x} cy={y} r={bulbD / 2}>
              <RadialGradient c={vec(x - bulbD * 0.15, y - bulbD * 0.15)} r={bulbD / 2} colors={["#E9D9A8", metal.off]} />
            </Circle>
          );
        })}
        {[0, 1].map((parity) => (
          <Group key={`lit${parity}`} opacity={parity === 0 ? evenLit : oddLit}>
            {Array.from({ length: BULBS }, (_, i) => i)
              .filter((i) => i % 2 === parity)
              .map((i) => {
                const { x, y } = at(bulbR, (i * 360) / BULBS);
                return (
                  <Group key={i}>
                    <Circle cx={x} cy={y} r={bulbD * 1.3}>
                      <RadialGradient c={vec(x, y)} r={bulbD * 1.3} colors={["rgba(255,214,120,0.55)", "rgba(255,214,120,0)"]} />
                    </Circle>
                    <Circle cx={x} cy={y} r={bulbD / 2}>
                      <RadialGradient c={vec(x - bulbD * 0.15, y - bulbD * 0.15)} r={bulbD / 2} colors={["#FFFFFF", "#FFF2C4", "#F2C14E"]} positions={[0, 0.4, 1]} />
                    </Circle>
                  </Group>
                );
              })}
          </Group>
        ))}
      </Canvas>

      {/* 2. The face: wedges, dividers, pegs and prizes turn together. */}
      <Animated.View style={[{ position: "absolute", left: rimT, top: rimT, width: face, height: face }, spin]}>
        <Canvas style={{ position: "absolute", left: 0, top: 0, width: face, height: face }}>
          {wedges.map((p, i) => (
            <Path key={i} path={p} color={FILL[fills[i] ?? "ivory"]} />
          ))}
          {highlight !== null && wedges[highlight] ? <Path path={wedges[highlight]} color="#FFFFFF" opacity={glow} /> : null}
          {Array.from({ length: count }, (_, i) => {
            const a = (((i + 0.5) * step) * Math.PI) / 180;
            return (
              <Line
                key={i}
                p1={vec(half, half)}
                p2={vec(half + half * Math.sin(a), half - half * Math.cos(a))}
                color="#D9A441"
                strokeWidth={2}
              />
            );
          })}
          {Array.from({ length: count }, (_, i) => {
            const a = (((i + 0.5) * step) * Math.PI) / 180;
            const x = half + pegR * Math.sin(a);
            const y = half - pegR * Math.cos(a);
            return (
              <Circle key={i} cx={x} cy={y} r={pegD / 2}>
                <RadialGradient c={vec(x - pegD * 0.15, y - pegD * 0.2)} r={pegD / 2} colors={["#FFF6D2", "#E7B847", "#8A5F12"]} positions={[0, 0.55, 1]} />
              </Circle>
            );
          })}
        </Canvas>
        {segments.map((s, i) => {
          const ink = INK[fills[i] ?? "ivory"];
          return (
            <View
              key={i}
              style={{ position: "absolute", left: half, top: half, width: 0, height: 0, transform: [{ rotate: `${i * step}deg` }] }}
            >
              <View style={{ position: "absolute", left: -labelW / 2, top: -labelR, width: labelW, alignItems: "center", gap: 3 }}>
                {"gems" in s ? <GemGlyph size={icon} /> : <CoinGlyph size={icon} />}
                <Text style={{ fontFamily: font.display, fontSize: num, lineHeight: num * 1.1, color: ink }}>
                  {"gems" in s ? formatExact(s.gems) : formatExact(s.coins)}
                </Text>
              </View>
            </View>
          );
        })}
      </Animated.View>

      {/* 3. The light (fixed) and the hub. */}
      <Canvas style={{ position: "absolute", left: 0, top: 0, width: S, height: S }} pointerEvents="none">
        <Circle cx={R} cy={R} r={half}>
          <RadialGradient c={vec(R, R)} r={half} colors={["rgba(8,10,20,0)", "rgba(8,10,20,0.38)"]} positions={[0.56, 1]} />
        </Circle>
        <Circle cx={R} cy={R} r={half}>
          <RadialGradient c={vec(R - half * 0.44, R - half * 0.76)} r={half * 1.1} colors={["rgba(255,255,255,0.30)", "rgba(255,255,255,0)"]} positions={[0, 0.45]} />
        </Circle>
        <Circle cx={R} cy={R + 2} r={hub / 2 + 1} color="rgba(0,0,0,0.35)" />
        <Circle cx={R} cy={R} r={hub / 2}>
          <LinearGradient start={vec(R - hub / 2, R - hub / 2)} end={vec(R + hub / 2, R + hub / 2)} colors={metal.stops} positions={METAL_POSITIONS} />
        </Circle>
        <Circle cx={R} cy={R} r={hub * 0.36}>
          <RadialGradient c={vec(R - hub * 0.06, R - hub * 0.1)} r={hub * 0.36} colors={["#34488C", "#1B2748"]} />
        </Circle>
        {star ? (
          <Group transform={[{ translateX: R - starSize / 2 }, { translateY: R - starSize / 2 }, { scale: starSize / 24 }]}>
            <Path path={star} color="#F4EFE2" />
          </Group>
        ) : null}
      </Canvas>

      {/* The pointer: a gold drop with a navy jewel, pointing down at the winning wedge. */}
      <Animated.View
        pointerEvents="none"
        style={[pointerSwing, {
          position: "absolute",
          left: R - pointer / 2,
          top: -pointer * 0.18,
          width: pointer,
          height: pointer,
          alignItems: "center",
          justifyContent: "center",
          shadowColor: palette.feltCharcoal,
          shadowOpacity: 0.5,
          shadowRadius: 3,
          shadowOffset: { width: 0, height: 3 },
          elevation: 4,
        }]}
      >
        <View
          style={{
            width: pointer * 0.78,
            height: pointer * 0.78,
            backgroundColor: "#F5C542",
            borderWidth: 1.5,
            borderColor: "#5A3D0A",
            borderTopLeftRadius: pointer,
            borderTopRightRadius: pointer,
            borderBottomLeftRadius: pointer,
            borderBottomRightRadius: 2,
            transform: [{ rotate: "45deg" }],
          }}
        />
        <View
          style={{
            position: "absolute",
            width: pointer * 0.38,
            height: pointer * 0.38,
            borderRadius: pointer,
            backgroundColor: "#1B2748",
            borderWidth: 2,
            borderColor: "#FFE7A6",
            top: pointer * 0.2,
          }}
        />
        <View
          style={{
            position: "absolute",
            width: pointer * 0.09,
            height: pointer * 0.09,
            borderRadius: pointer,
            backgroundColor: palette.porcelain,
            opacity: 0.85,
            top: pointer * 0.27,
            left: pointer * 0.41,
          }}
        />
      </Animated.View>
    </View>
  );
}

/**
 * The wheel in miniature for the Home tile: the same metal rim, ivory and navy
 * wedges and a hub, no bulbs or prizes. `muted` greys it for "nothing owed" and
 * "locked".
 */
export function MiniWheel({ size, wheel, muted = false }: { size: number; wheel: string; muted?: boolean }) {
  const R = size / 2;
  const rimT = size * 0.11;
  const faceR = R - rimT;
  const metal = muted
    ? { stops: ["#C9CED6", "#8E959F", "#5C626B", "#A7AFBB", "#6E747D"] }
    : METALS[rimMetal(wheel)];
  const ivory = muted ? "#8A8F97" : FILL.ivory;
  const navy = muted ? "#3A3F47" : FILL.navy;
  const wedges = useMemo(() => {
    const oval = Skia.XYWHRect(R - faceR, R - faceR, faceR * 2, faceR * 2);
    return Array.from({ length: 8 }, (_, i) =>
      Skia.PathBuilder.Make()
        .moveTo(R, R)
        .arcToOval(oval, -90 + i * 45 - 22.5, 45, false)
        .close()
        .detach(),
    );
  }, [R, faceR]);
  const tip = Math.max(5, size * 0.2);
  return (
    <View style={{ width: size, height: size }}>
    <Canvas style={{ width: size, height: size }}>
      <Circle cx={R} cy={R} r={R}>
        <LinearGradient start={vec(0, 0)} end={vec(size, size)} colors={metal.stops} positions={METAL_POSITIONS} />
      </Circle>
      {wedges.map((p, i) => (
        <Path key={i} path={p} color={i % 2 === 0 ? ivory : navy} />
      ))}
      <Circle cx={R} cy={R} r={faceR}>
        <RadialGradient c={vec(R - faceR * 0.4, R - faceR * 0.7)} r={faceR * 1.1} colors={["rgba(255,255,255,0.28)", "rgba(255,255,255,0)"]} positions={[0, 0.5]} />
      </Circle>
      <Circle cx={R} cy={R} r={size * 0.13}>
        <LinearGradient start={vec(R - size * 0.13, R - size * 0.13)} end={vec(R + size * 0.13, R + size * 0.13)} colors={metal.stops} positions={METAL_POSITIONS} />
      </Circle>
      <Circle cx={R} cy={R} r={size * 0.06} color={muted ? "#3A3F47" : "#1B2748"} />
    </Canvas>
      {/* A small pointer on top: it is what makes this read as a prize wheel. */}
      <View
        style={{
          position: "absolute",
          top: -tip * 0.35,
          left: R - tip / 2,
          width: 0,
          height: 0,
          borderLeftWidth: tip / 2,
          borderRightWidth: tip / 2,
          borderTopWidth: tip * 0.85,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderTopColor: muted ? palette.mutedSteel : "#F5C542",
        }}
      />
    </View>
  );
}
