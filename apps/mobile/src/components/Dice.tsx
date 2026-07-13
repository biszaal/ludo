/**
 * The game die (Ludo Club look), drawn entirely on ONE Skia canvas so nothing
 * remounts or re-renders mid-roll — the old RN-view die redrew its pip views
 * from a 55ms face-shuffle interval, which read as flicker.
 *
 * Three states, all painted per-frame into a single Picture on the UI thread:
 * - awaiting a roll: no pips — a swirl pattern on the face (wiggles when the
 *   local player can tap it to roll);
 * - rolling: a true 3D cube tumble (orthographic projection from dieMath),
 *   which lands with the real rolled value on the camera face — no shuffle;
 * - landed: the flat face with that value's pips, plus a settle squash.
 */

import { useEffect, useMemo, useRef } from "react";
import { Pressable, View } from "react-native";
import { Canvas, Picture, PaintStyle, Skia, StrokeCap, StrokeJoin } from "@shopify/react-native-skia";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { playDiceRoll } from "../lib/sound";
import { diceSettle } from "../lib/haptics";
import type { BoardTheme } from "../render/boardThemes";
import { cubeFaces, faceMatrix, lambert, rotateScaleAbout, rotateVec } from "../render/dieMath";

/** Pip centers on a unit face (x, y in 0..1), per die value. */
const PIP_XY: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.26, 0.26], [0.74, 0.74]],
  3: [[0.26, 0.26], [0.5, 0.5], [0.74, 0.74]],
  4: [[0.26, 0.26], [0.74, 0.26], [0.26, 0.74], [0.74, 0.74]],
  5: [[0.26, 0.26], [0.74, 0.26], [0.5, 0.5], [0.26, 0.74], [0.74, 0.74]],
  6: [[0.26, 0.22], [0.74, 0.22], [0.26, 0.5], [0.74, 0.5], [0.26, 0.78], [0.74, 0.78]],
};

const ROLL_MS = 950;
/** Fraction of the roll spent tumbling; the rest is the landing squash. */
const CUBE_END = 0.8;

/** "#RRGGBB" → [r, g, b] for the worklet color mixer. */
function hexRGB(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

interface DiceProps {
  value: number | null;
  size?: number;
  /** Bump to replay the tumble animation. */
  spinSeq?: number;
  /** Awaiting a roll: show the swirl pattern instead of a face value. */
  idle?: boolean;
  /** Board theme supplying face/pip colors (defaults white/ink). */
  theme?: BoardTheme;
  /** When set, the die is tappable (it wiggles) — tapping rolls, or reclaims
   *  the seat from autopilot (the caller decides). */
  onRollPress?: (() => void) | null;
  /** Accessibility label while tappable (differs for roll vs bot-reclaim). */
  pressLabel?: string;
}

export function Dice({ value, size = 64, spinSeq = 0, idle = false, theme, onRollPress = null, pressLabel = "Roll the dice" }: DiceProps) {
  // 0→1 over a roll; rests at 1 (settled). Starts settled so remounting at the
  // next player's corner never replays the tumble (the old double-roll bug).
  const roll = useSharedValue(1);
  const wiggle = useSharedValue(0);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!spinSeq) return;
    playDiceRoll();
    cancelAnimation(roll);
    roll.value = 0;
    roll.value = withTiming(1, { duration: ROLL_MS, easing: Easing.linear });
    // Haptic on impact — when the tumble lands, not when the squash finishes.
    const settle = setTimeout(diceSettle, ROLL_MS * CUBE_END);
    return () => clearTimeout(settle);
  }, [spinSeq, roll]);

  // "Tap me" wiggle while the die is waiting to be rolled.
  useEffect(() => {
    if (onRollPress) {
      wiggle.value = withRepeat(
        withSequence(
          withTiming(-1, { duration: 260, easing: Easing.inOut(Easing.quad) }),
          withTiming(1, { duration: 260, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        true,
      );
    } else {
      cancelAnimation(wiggle);
      wiggle.value = withTiming(0, { duration: 120 });
    }
    return () => cancelAnimation(wiggle);
  }, [onRollPress !== null, wiggle]);

  const faceRGB = useMemo(() => hexRGB(theme?.dice.face ?? "#FFFFFF"), [theme]);
  const pipRGB = useMemo(() => hexRGB(theme?.dice.pip ?? "#17181C"), [theme]);

  // Canvas is padded beyond the die so the mid-flight scale-up and the ground
  // shadow have room (corner-on at apex the cube's half-diagonal reaches
  // √3 · 1.3 · size/2 ≈ 1.13 · size/2); the layout footprint stays `size`.
  const pad = Math.round(size * 0.65);
  const canvasSide = size + pad * 2;
  const c = canvasSide / 2;
  const seed = spinSeq;
  const shownValue = value ?? 1;

  const picture = useDerivedValue(() => {
    const mix = (rgb: [number, number, number], amt: number) => {
      const target = amt >= 0 ? 255 : 0;
      const p = Math.abs(amt);
      const ch = (v: number) => Math.round((target - v) * p + v);
      return Skia.Color((((255 << 24) | (ch(rgb[0]) << 16) | (ch(rgb[1]) << 8) | ch(rgb[2])) >>> 0));
    };

    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, canvasSide, canvasSide));
    const p = roll.value;
    const tumbling = p < CUBE_END;
    const t = Math.min(p / CUBE_END, 1);
    const ease = 1 - (1 - t) * (1 - t) * (1 - t);
    const lift = Math.sin(Math.PI * t); // 0 grounded → 1 apex → 0 landed

    // Ground shadow: shrinks and fades while the die is airborne.
    const shadow = Skia.Paint();
    shadow.setAntiAlias(true);
    shadow.setColor(Skia.Color(`rgba(0, 0, 0, ${0.26 * (1 - lift * 0.55)})`));
    const shW = size * 0.5 * (1 - lift * 0.3);
    const shH = size * 0.13 * (1 - lift * 0.3);
    canvas.drawOval(Skia.XYWHRect(c - shW, c + size * 0.56 - shH, shW * 2, shH * 2), shadow);

    if (tumbling) {
      // Tumble angles unwind to exactly zero at CUBE_END, so the cube always
      // lands at identity — real value toward the camera. Seeded per roll so
      // consecutive rolls take different-looking paths.
      const back = 1 - ease;
      const ax = (2 + (seed % 3) * 0.5) * 2 * Math.PI * back;
      const ay = (seed % 2 === 0 ? 1 : -1) * (1 + ((seed * 3) % 4) * 0.25) * 2 * Math.PI * back;
      const az = 0.5 * back * Math.sin(7 * t + seed);
      const h = (size / 2) * (1 + 0.3 * lift); // grows toward the camera mid-flight

      const core = Skia.Paint();
      core.setAntiAlias(true);
      core.setColor(mix(faceRGB, -0.55));
      const facePaint = Skia.Paint();
      facePaint.setAntiAlias(true);
      const pipPaint = Skia.Paint();
      pipPaint.setAntiAlias(true);
      pipPaint.setColor(mix(pipRGB, 0));

      // Cull faces nearly edge-on (they draw as stray hairline slivers).
      const visible = cubeFaces(shownValue)
        .map((face) => ({
          face,
          n: rotateVec(face.n, ax, ay, az),
          u: rotateVec(face.u, ax, ay, az),
          v: rotateVec(face.v, ax, ay, az),
        }))
        .filter(({ n }) => n.z < -0.06);

      // Pass 1 — slightly oversized dark cores behind the faces, so the gaps
      // left by rounded face corners read as the die's darker edges. Core
      // rounding matches the faces so the silhouette stays curved — the
      // resting face rounds at 24% of its edge (see below), and local units
      // span 2 per edge, so 0.5 here is that same 24% scaled up 4%. Skipped
      // when the die is face-on (single face): there are no gaps to fill and
      // the core would show as a rim around the landing face.
      if (visible.length > 1) {
        for (const { n, u, v } of visible) {
          canvas.save();
          canvas.concat(Skia.Matrix(faceMatrix(u, v, n, h, c, c)));
          canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(-1.04, -1.04, 2.08, 2.08), 0.5, 0.5), core);
          canvas.restore();
        }
      }

      // Pass 2 — lit faces with their pips (face-local circles come out as
      // properly foreshortened ellipses through the same matrix). Corner
      // radius 0.48 = the resting face's 24%, keeping the rounding constant
      // between the tumble and the flat die.
      for (const { face, n, u, v } of visible) {
        facePaint.setColor(mix(faceRGB, -0.46 + 0.62 * lambert(n)));
        canvas.save();
        canvas.concat(Skia.Matrix(faceMatrix(u, v, n, h, c, c)));
        canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(-1, -1, 2, 2), 0.48, 0.48), facePaint);
        for (const [px, py] of PIP_XY[face.value]!) {
          canvas.drawCircle((px - 0.5) * 1.84, (py - 0.5) * 1.84, 0.17, pipPaint);
        }
        canvas.restore();
      }
    } else {
      // Settled flat face with the landing squash (pivoting at the die's base).
      // The tap-me wiggle lives on the Canvas view's transform instead — inside
      // this recording it forced a full picture re-record every frame for as
      // long as the die was tappable, hogging the UI thread between turns.
      const q = (p - CUBE_END) / (1 - CUBE_END);
      const squash = Math.sin(Math.PI * Math.min(q, 1));
      canvas.concat(Skia.Matrix(rotateScaleAbout(0, 1 + 0.07 * squash, 1 - 0.11 * squash, c, c + size / 2)));

      const x = c - size / 2;
      const y = c - size / 2;
      const rounded = size * 0.24;
      const edge = Skia.Paint();
      edge.setAntiAlias(true);
      edge.setColor(mix(faceRGB, -0.25));
      canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(x, y, size, size), rounded, rounded), edge);
      const facePaint = Skia.Paint();
      facePaint.setAntiAlias(true);
      facePaint.setColor(mix(faceRGB, 0));
      canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(x, y, size, size - 3), rounded, rounded), facePaint);

      const ink = Skia.Paint();
      ink.setAntiAlias(true);
      ink.setColor(mix(pipRGB, 0));
      if (idle || value === null) {
        // Swirl pattern: an outward spiral stroke — "not rolled yet".
        ink.setStyle(PaintStyle.Stroke);
        ink.setStrokeWidth(size * 0.085);
        ink.setStrokeCap(StrokeCap.Round);
        ink.setStrokeJoin(StrokeJoin.Round);
        const spiral = Skia.Path.Make();
        const steps = 44;
        for (let i = 0; i <= steps; i++) {
          const st = i / steps;
          const angle = st * 2.25 * 2 * Math.PI - Math.PI / 2;
          const radius = size * 0.3 * Math.pow(st, 0.85);
          const sx = c + Math.cos(angle) * radius;
          const sy = c - 1.5 + Math.sin(angle) * radius;
          if (i === 0) spiral.moveTo(sx, sy);
          else spiral.lineTo(sx, sy);
        }
        canvas.drawPath(spiral, ink);
      } else {
        const pip = size * 0.17;
        for (const [px, py] of PIP_XY[shownValue]!) {
          canvas.drawCircle(x + px * size, y + py * (size - 3), pip / 2, ink);
        }
      }
    }

    return rec.finishRecordingAsPicture();
  });

  // The wiggle rocks the whole (padded) canvas around the die's center as a
  // plain view transform — pure compositor work, no Skia re-recording. The
  // tumble suppresses it: mid-roll the wiggle is already animated back to 0.
  const wiggleStyle = useAnimatedStyle(() => {
    const ws = 1 + Math.abs(wiggle.value) * 0.04;
    return { transform: [{ rotate: `${wiggle.value * 6}deg` }, { scale: ws }] };
  });

  const label = idle || value === null ? "Dice" : `Dice showing ${value}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={onRollPress ? pressLabel : label}
      onPress={onRollPress ?? undefined}
      disabled={!onRollPress}
      hitSlop={10}
    >
      <View style={{ width: size, height: size }}>
        <Animated.View
          pointerEvents="none"
          style={[{ position: "absolute", left: -pad, top: -pad, width: canvasSide, height: canvasSide }, wiggleStyle]}
        >
          <Canvas style={{ width: canvasSide, height: canvasSide }}>
            <Picture picture={picture} />
          </Canvas>
        </Animated.View>
      </View>
    </Pressable>
  );
}
