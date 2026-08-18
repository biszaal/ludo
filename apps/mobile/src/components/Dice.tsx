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
 *   a tumble started before the server value arrives (value=null) hangs at the
 *   top of its arc and keeps spinning until the value lands, so a slow request
 *   reads as a longer roll and the die never settles on a stale face;
 * - landed: the flat face with that value's pips, plus a settle squash.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Pressable, View } from "react-native";
import { BlurStyle, Canvas, ClipOp, Picture, PaintStyle, Skia, StrokeCap, StrokeJoin, TileMode } from "@shopify/react-native-skia";
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
import { DICE_ROLL_MS } from "../lib/moveTiming";
import type { BoardTheme } from "../render/boardThemes";
import { diceRenderParams, type DiceSkin } from "../render/diceSkins";
import { cubeFaces, faceMatrix, lambert, rotateScaleAbout, rotateVec } from "../render/dieMath";
import { appendPip, overlayArt } from "../render/pipShapes";

/** Pip centers on a unit face (x, y in 0..1), per die value. */
const PIP_XY: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.26, 0.26], [0.74, 0.74]],
  3: [[0.26, 0.26], [0.5, 0.5], [0.74, 0.74]],
  4: [[0.26, 0.26], [0.74, 0.26], [0.26, 0.74], [0.74, 0.74]],
  5: [[0.26, 0.26], [0.74, 0.26], [0.5, 0.5], [0.26, 0.74], [0.74, 0.74]],
  6: [[0.26, 0.22], [0.74, 0.22], [0.26, 0.5], [0.74, 0.5], [0.26, 0.78], [0.74, 0.78]],
};

/** Owned by lib/moveTiming, which the sync path uses to hold the next state
 *  until this tumble has visibly landed. One number, so the two can't drift. */
const ROLL_MS = DICE_ROLL_MS;
/** Fraction of the roll spent tumbling; the rest is the landing squash. */
const CUBE_END = 0.8;
/** Where the arc parks while the server value is in flight: the apex, where the
 *  die is at its largest and most clearly off the ground. */
const HOLD_P = CUBE_END * 0.5;
/** Turns the hold spin is given up front. Only needs to outlast HOLD_BAIL_MS at
 *  HOLD_TURN_MS each; it is a budget, not a target, since the landing cuts it
 *  short at the next whole turn. */
const HOLD_TURNS = 40;
/** One whole extra turn of the hold spin. Roughly the rate the free tumble is
 *  already turning at when it reaches HOLD_P, so entering and leaving the hold
 *  doesn't read as a change of speed. */
const HOLD_TURN_MS = 320;
/** Give up on a value that never arrives (request failed) and settle to idle. */
const HOLD_BAIL_MS = 9000;

interface DiceProps {
  value: number | null;
  size?: number;
  /** Bump to replay the tumble animation. */
  spinSeq?: number;
  /** Awaiting a roll: show the swirl pattern instead of a face value. */
  idle?: boolean;
  /** Board theme supplying face/pip colors (defaults white/ink). */
  theme?: BoardTheme;
  /** The roller's equipped dice skin. Classic (or undefined) inherits `theme`,
   *  matching the die's pre-cosmetics look exactly. */
  skin?: DiceSkin;
  /** When set, the die is tappable (it wiggles) — tapping rolls, or reclaims
   *  the seat from autopilot (the caller decides). */
  onRollPress?: (() => void) | null;
  /** Accessibility label while tappable (differs for roll vs bot-reclaim). */
  pressLabel?: string;
}

export function Dice({ value, size = 64, spinSeq = 0, idle = false, theme, skin, onRollPress = null, pressLabel = "Roll the dice" }: DiceProps) {
  // 0→1 over a roll; rests at 1 (settled). Starts settled so remounting at the
  // next player's corner never replays the tumble (the old double-roll bug).
  const roll = useSharedValue(1);
  const wiggle = useSharedValue(0);
  const mounted = useRef(false);
  // The die must never land without an authoritative value: a tumble started
  // with value=null (the roller's optimistic tap — the server hasn't answered
  // yet) holds airborne until the value prop arrives, then unwinds to land on
  // it. `holding` marks that in-flight wait.
  const valueRef = useRef(value);
  valueRef.current = value;
  const holding = useRef(false);
  // Whole extra turns added on top of the arc's own angles, in turns (1 = 360°).
  // Only the hold uses it: because a whole turn is the identity rotation, a
  // 0->1 loop wraps invisibly and a landing that ends on a whole number leaves
  // the rolled face pointing at the camera exactly as before.
  const spin = useSharedValue(0);
  // Read in the bail timeout, which fires long after its own render.
  const tappable = onRollPress !== null;
  const tappableRef = useRef(tappable);
  tappableRef.current = tappable;

  // The "tap me" wiggle's two halves. Declared up here because the roll effect
  // below lists them as dependencies, and a dep array is evaluated during the
  // render that reaches it — a `const` defined further down would still be in
  // its temporal dead zone at that point.
  const startWiggle = useCallback(() => {
    wiggle.value = withRepeat(
      withSequence(
        withTiming(-1, { duration: 260, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 260, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      true,
    );
  }, [wiggle]);

  const stopWiggle = useCallback(() => {
    cancelAnimation(wiggle);
    wiggle.value = withTiming(0, { duration: 120 });
  }, [wiggle]);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!spinSeq) return;
    playDiceRoll();
    // A die that is already rolling is not asking to be tapped. Nothing used to
    // stop the wiggle here, and the roll leaves `onRollPress` set for as long as
    // the server takes to answer (phase is still awaiting-roll until then), so
    // the whole canvas rocked ±6° through the wait — the loudest part of the
    // "die going back and forth" while the request was in flight.
    stopWiggle();
    cancelAnimation(roll);
    cancelAnimation(spin);
    roll.value = 0;
    spin.value = 0;
    if (valueRef.current != null) {
      holding.current = false;
      roll.value = withTiming(1, { duration: ROLL_MS, easing: Easing.linear });
      // Haptic on impact — when the tumble lands, not when the squash finishes.
      const settle = setTimeout(diceSettle, ROLL_MS * CUBE_END);
      return () => clearTimeout(settle);
    }
    // Value unknown: tumble up to the apex, park the arc there and let `spin`
    // carry the rotation until the value effect below resumes the landing.
    //
    // The hold used to ping-pong the arc parameter itself between two airborne
    // points. Every angle in the tumble is a function of that parameter, so
    // driving it backwards drove the cube backwards: on a connection slow
    // enough to hold for more than one leg, the die visibly rocked to and fro
    // instead of rolling. Whole turns are the only way to keep spinning
    // without moving along the arc, and they cost nothing at the landing.
    holding.current = true;
    // Ease OUT into the park. The arc contributes rotation of its own while it
    // moves, so stopping it linearly drops that contribution to zero in a single
    // frame — a step down in the die's total speed, which is the hitch. Easing
    // out brings the arc's own velocity smoothly to zero instead, and `spin`
    // below is already turning at the rate it hands over at, so the die rolls
    // through the junction at one unbroken speed.
    roll.value = withTiming(HOLD_P, { duration: ROLL_MS * HOLD_P, easing: Easing.out(Easing.quad) });
    // ONE animation, not a repeat. withRepeat restarts its timing from the
    // start value every cycle, so the turn counter sawtoothed 0->1->0->1 and
    // the die hitched once per turn — the jerk you can see in the wait. Handing
    // the same linear timing a large target instead means the angle only ever
    // increases, at a constant rate, with no boundary to stutter at: it just
    // keeps rolling the way the local (value-known) tumble does, until the
    // server answers.
    spin.value = withTiming(HOLD_TURNS, {
      duration: HOLD_TURNS * HOLD_TURN_MS,
      easing: Easing.linear,
    });
    const bail = setTimeout(() => {
      if (!holding.current) return;
      holding.current = false;
      cancelAnimation(roll);
      cancelAnimation(spin);
      spin.value = 0;
      roll.value = 1; // settles to the idle swirl — value is still null
      // The roll never happened and the seat is still theirs, so put the "tap
      // me" hint back rather than leaving a dead-looking die.
      if (tappableRef.current) startWiggle();
    }, HOLD_BAIL_MS);
    return () => clearTimeout(bail);
  }, [spinSeq, roll, spin, startWiggle, stopWiggle]);

  // The held tumble's landing: the authoritative value arrived mid-flight —
  // resume the same parametric curve from wherever the hold left it, so the
  // hand-off is seamless and the re-recorded picture bakes in the real face.
  useEffect(() => {
    if (value == null || !holding.current) return;
    holding.current = false;
    cancelAnimation(roll);
    cancelAnimation(spin);
    const p = Math.min(roll.value, HOLD_P);
    roll.value = p;
    // Mirror of the park: ease IN so the arc picks its rotation back up from
    // zero rather than snapping straight to full speed the instant the server
    // answers. Between the two, the die's speed is continuous across both ends
    // of the wait instead of stepping down and back up.
    roll.value = withTiming(1, { duration: ROLL_MS * (1 - p), easing: Easing.in(Easing.quad) });
    // Finish the turn the hold was part-way through, timed to complete exactly
    // as the cube goes flat — landing on a whole turn is what keeps the extra
    // rotation invisible in the settled face. Stopping mid-turn instead would
    // land the die tilted.
    const landMs = Math.max(0, ROLL_MS * (CUBE_END - p));
    // Land on a whole turn, but pick WHICH whole turn by how far the die would
    // have spun anyway in landMs. Rounding blindly up to the next one is what
    // still hitched after the sawtooth was gone: the hold turns at
    // 1/HOLD_TURN_MS, and if it happened to be a hair short of a whole turn
    // when the answer arrived, the die was asked to cover that hair over the
    // whole landing — an abrupt near-stall at exactly the moment the server
    // replied. Choosing the NEAREST whole turn to where it was already headed
    // keeps the rate within half a turn of the one it was already at, so the
    // handover from spinning to landing is continuous.
    const natural = spin.value + landMs / HOLD_TURN_MS;
    spin.value = withTiming(Math.max(Math.round(natural), Math.ceil(spin.value)), {
      duration: landMs,
      easing: Easing.linear,
    });
    const settle = setTimeout(diceSettle, landMs);
    return () => clearTimeout(settle);
  }, [value, roll, spin]);

  // Wiggle while the die is waiting to be rolled. A roll in progress stops it
  // (above) without this effect re-running — `tappable` doesn't change on the
  // tap — so once a tumble starts the hint stays down for the rest of the turn,
  // which is right: what follows a landed roll is a move, not another roll.
  useEffect(() => {
    if (tappable) startWiggle();
    else stopWiggle();
    return () => cancelAnimation(wiggle);
  }, [tappable, startWiggle, stopWiggle, wiggle]);

  // Single memoized object crossing into the worklet closure below — an inline
  // object here would change identity every render and force a full picture
  // re-record each time (see the file header: that's exactly the flicker this
  // component exists to avoid).
  const sp = useMemo(() => diceRenderParams(skin, theme), [skin, theme]);

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
      // `spin` adds whole turns on both tumble axes for the airborne hold —
      // zero on an ordinary roll, and a whole number by the time the arc
      // reaches CUBE_END, so the identity-at-landing guarantee above survives.
      const back = 1 - ease;
      const extra = spin.value * 2 * Math.PI;
      const dir = seed % 2 === 0 ? 1 : -1;
      const ax = (2 + (seed % 3) * 0.5) * 2 * Math.PI * back + extra;
      const ay = dir * ((1 + ((seed * 3) % 4) * 0.25) * 2 * Math.PI * back + extra);
      const az = 0.5 * back * Math.sin(7 * t + seed);
      const h = (size / 2) * (1 + 0.3 * lift); // grows toward the camera mid-flight

      const core = Skia.Paint();
      core.setAntiAlias(true);
      core.setColor(sp.edgeRGB ? mix(sp.edgeRGB, 0) : mix(sp.faceRGB, -0.55));
      const facePaint = Skia.Paint();
      facePaint.setAntiAlias(true);
      const pipPaint = Skia.Paint();
      pipPaint.setAntiAlias(true);
      pipPaint.setColor(mix(sp.pipRGB, 0));
      // Same darker-rim trick as the landed face: a shaped pip is only a
      // couple of local units across here, so the outline — not the fill —
      // is what actually reads as a shape while the cube is spinning.
      const outlinePaint = Skia.Paint();
      outlinePaint.setAntiAlias(true);
      outlinePaint.setStyle(PaintStyle.Stroke);
      outlinePaint.setStrokeWidth(0.05);
      outlinePaint.setStrokeJoin(StrokeJoin.Round);
      outlinePaint.setColor(mix(sp.pipRGB, -0.45));

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

      // Pass 2 — lit faces with their pips (face-local geometry comes out as
      // properly foreshortened shapes through the same matrix). Corner radius
      // 0.48 = the resting face's 24%, keeping the rounding constant between
      // the tumble and the flat die. Premium skins keep their gradient and
      // pip shape here too, not just once landed — only the decorative
      // overlay texture and the pip glow stay landed-only: those cost a lot
      // more per draw, and at tumbling speed neither would read anyway.
      for (const { face, n, u, v } of visible) {
        canvas.save();
        canvas.concat(Skia.Matrix(faceMatrix(u, v, n, h, c, c)));
        if (sp.gradient) {
          facePaint.setShader(
            Skia.Shader.MakeLinearGradient(
              { x: -1, y: -1 },
              { x: 1, y: 1 },
              sp.gradient.colors.map((cc) => Skia.Color(cc)),
              sp.gradient.stops,
              TileMode.Clamp,
            ),
          );
          // The shader replaces per-face lambert shading, so fake back a hint
          // of it via alpha (modulates the shader's own output) — otherwise a
          // gradient skin's cube looks flat next to a solid-color one's.
          facePaint.setAlphaf(0.72 + 0.28 * lambert(n));
        } else {
          facePaint.setShader(null);
          facePaint.setColor(mix(sp.faceRGB, -0.46 + 0.62 * lambert(n)));
        }
        canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(-1, -1, 2, 2), 0.48, 0.48), facePaint);
        if (sp.pipShape === "dot") {
          for (const [px, py] of PIP_XY[face.value]!) {
            canvas.drawCircle((px - 0.5) * 1.84, (py - 0.5) * 1.84, 0.17, pipPaint);
          }
        } else {
          const facePips = Skia.Path.Make();
          for (const [px, py] of PIP_XY[face.value]!) {
            appendPip(facePips, sp.pipShape, (px - 0.5) * 1.84, (py - 0.5) * 1.84, 0.19);
          }
          canvas.drawPath(facePips, outlinePaint);
          canvas.drawPath(facePips, pipPaint);
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
      const faceH = size - 3;

      const edge = Skia.Paint();
      edge.setAntiAlias(true);
      edge.setColor(sp.edgeRGB ? mix(sp.edgeRGB, 0) : mix(sp.faceRGB, -0.25));
      canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(x, y, size, size), rounded, rounded), edge);

      const faceRRect = Skia.RRectXY(Skia.XYWHRect(x, y, size, faceH), rounded, rounded);
      const facePaint = Skia.Paint();
      facePaint.setAntiAlias(true);
      if (sp.gradient) {
        facePaint.setShader(
          Skia.Shader.MakeLinearGradient(
            { x, y },
            { x: x + size, y: y + faceH },
            sp.gradient.colors.map((cc) => Skia.Color(cc)),
            sp.gradient.stops,
            TileMode.Clamp,
          ),
        );
      } else {
        facePaint.setColor(mix(sp.faceRGB, 0));
      }
      canvas.drawRRect(faceRRect, facePaint);

      // Overlay: a cheap deterministic texture pass (grain/veins/stars/facets),
      // clipped to the face. Recorded once per landing along with everything
      // else in this branch — the tumble never touches it.
      if (sp.overlay) {
        const art = overlayArt(sp.overlay, sp.overlaySeed);
        canvas.save();
        canvas.clipRRect(faceRRect, ClipOp.Intersect, true);
        const dotPaint = Skia.Paint();
        dotPaint.setAntiAlias(true);
        dotPaint.setColor(mix(sp.pipRGB, 0));
        for (const d of art.dots) {
          dotPaint.setAlphaf(d.a);
          canvas.drawCircle(x + d.x * size, y + d.y * faceH, d.r * size, dotPaint);
        }
        const strokePaint = Skia.Paint();
        strokePaint.setAntiAlias(true);
        strokePaint.setStyle(PaintStyle.Stroke);
        strokePaint.setStrokeCap(StrokeCap.Round);
        strokePaint.setColor(mix(sp.pipRGB, 0));
        for (const st of art.strokes) {
          strokePaint.setAlphaf(st.a);
          strokePaint.setStrokeWidth(st.w * size);
          const strokePath = Skia.Path.Make();
          st.pts.forEach(([px, py], i) => {
            if (i === 0) strokePath.moveTo(x + px * size, y + py * faceH);
            else strokePath.lineTo(x + px * size, y + py * faceH);
          });
          canvas.drawPath(strokePath, strokePaint);
        }
        canvas.restore();
      }

      // Frame: a rim stroke reserved for the top prestige skins.
      if (sp.frame) {
        const frame = Skia.Paint();
        frame.setAntiAlias(true);
        frame.setStyle(PaintStyle.Stroke);
        frame.setStrokeWidth(size * 0.045);
        frame.setColor(Skia.Color(sp.frame));
        canvas.drawRRect(faceRRect, frame);
      }

      const ink = Skia.Paint();
      ink.setAntiAlias(true);
      ink.setColor(mix(sp.pipRGB, 0));
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
      } else if (sp.pipShape === "dot") {
        const pip = size * 0.17;
        for (const [px, py] of PIP_XY[shownValue]!) {
          canvas.drawCircle(x + px * size, y + py * faceH, pip / 2, ink);
        }
      } else {
        // Shaped pips (skins above the starter tier). At the die's actual
        // in-game size (~48px) a heart/star/diamond/crown/flame silhouette is
        // only a few pixels across — too small for its outline alone to read
        // as anything but a round dot. A soft glow pass underneath plus a
        // darker outline stroke around the glyph (classic small-icon
        // technique: the rim, not the fill color, is what actually carries
        // the shape at this scale) fix that; the solid fill goes on top. One
        // shared path, drawn up to three times, so every pip on the face
        // still costs a single path build per landing.
        const r = size * 0.12;
        const pipPath = Skia.Path.Make();
        for (const [px, py] of PIP_XY[shownValue]!) {
          appendPip(pipPath, sp.pipShape, x + px * size, y + py * faceH, r);
        }
        if (sp.glow) {
          const glow = Skia.Paint();
          glow.setAntiAlias(true);
          glow.setColor(Skia.Color(sp.glow));
          glow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, size * 0.08, true));
          canvas.drawPath(pipPath, glow);
        }
        const outline = Skia.Paint();
        outline.setAntiAlias(true);
        outline.setStyle(PaintStyle.Stroke);
        outline.setStrokeWidth(size * 0.034);
        outline.setStrokeJoin(StrokeJoin.Round);
        outline.setColor(mix(sp.pipRGB, -0.45));
        canvas.drawPath(pipPath, outline);
        canvas.drawPath(pipPath, ink);
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
