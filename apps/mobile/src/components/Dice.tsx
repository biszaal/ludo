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
 *
 * THE ROLL IS ONE CONTINUOUS PHASE, and its length is the server's.
 *
 * The value is server-generated, so for the first stretch of an online roll
 * there is nothing to land on. `spin` counts REVOLUTIONS and each axis is an
 * integer multiple of it, so every whole revolution is the identity rotation
 * with the rolled face square to the camera. While the answer is outstanding
 * the phase simply climbs at a constant rate; when it arrives, the phase eases
 * to the next whole revolution but one, over an arc sized (diceLandingMs) to
 * OPEN at exactly the speed it was already turning. There is no step in speed
 * anywhere, so a slow connection is one long roll rather than two short ones.
 *
 * Two earlier designs are worth knowing about, because both failed in ways this
 * one is shaped to avoid:
 *
 *   * A SECOND ROTATION carried the wait while the tumble arc was parked
 *     mid-flight (reverted in 09b0606). Two sources feeding one die meant the
 *     speed jumped wherever they met, and each fix only moved the junction.
 *     Here there is one source and no handover — the wait and the landing are
 *     the same number moving at the same speed across the join.
 *   * FIXED LAPS that ran again when the answer was late. That never stopped on
 *     a placeholder, but every lap still eased out to a near-halt before
 *     speeding up, which players read — correctly — as the die rolling twice.
 *     It was reliable on the first roll of a game, where the prefetch has not
 *     landed and the slow path is guaranteed.
 *
 * Nothing is inked onto a tumbling face until there is something true to ink,
 * which is the other half of the same story: the cube is laid out around a
 * placeholder because it must be arranged around something, but it carries no
 * number until the server has answered. See dieMath.tumbleFaceValue.
 *
 * A roll answered at the tap — every offline one, and every online one whose die
 * was prefetched — starts at phase zero and goes straight into the landing, so
 * it animates in DICE_LANDING_MS exactly as it always has.
 */

import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { Pressable, View } from "react-native";
import { BlurStyle, Canvas, ClipOp, Picture, PaintStyle, Skia, StrokeCap, StrokeJoin, TileMode } from "@shopify/react-native-skia";
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useFullMotion } from "../lib/useMotion";
import { playDiceRoll } from "../lib/sound";
import { diceSettle } from "../lib/haptics";
import {
  DICE_LANDING_MS,
  DICE_MAX_ROLL_MS,
  DICE_SETTLE_MS,
  DICE_SPIN_REV_PER_MS,
  DICE_TURNS_X,
  DICE_TURNS_Y,
  diceLandingMs,
  diceLandingTarget,
} from "../lib/moveTiming";
import type { BoardTheme } from "../render/boardThemes";
import { diceRenderParams, type DiceSkin } from "../render/diceSkins";
import { cubeFaces, faceMatrix, lambert, rotateScaleAbout, rotateVec, swirlPoints, tumbleFaceValue, type Vec3 } from "../render/dieMath";
import { appendMotif, motifStyle } from "../render/faceMotifs";
import { appendPip, overlayArt } from "../render/pipShapes";
import { appendNumeral, NUMERAL_FACE_R, NUMERAL_KEYLINE, NUMERAL_STROKE, type Numeral } from "../render/dieNumerals";

/** Pip centers on a unit face (x, y in 0..1), per die value. */
const PIP_XY: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.26, 0.26], [0.74, 0.74]],
  3: [[0.26, 0.26], [0.5, 0.5], [0.74, 0.74]],
  4: [[0.26, 0.26], [0.74, 0.26], [0.26, 0.74], [0.74, 0.74]],
  5: [[0.26, 0.26], [0.74, 0.26], [0.5, 0.5], [0.26, 0.74], [0.74, 0.74]],
  6: [[0.26, 0.22], [0.74, 0.22], [0.26, 0.5], [0.74, 0.5], [0.26, 0.78], [0.74, 0.78]],
};

/**
 * Blend a color toward white (`amt > 0`) or black (`amt < 0`).
 *
 * Marked "worklet" because both sides need it: the memoized paint kit builds
 * its constant colors with it on the JS thread, and the picture below still
 * shades each tumbling face with it per frame on the UI thread. A plain
 * closure captured into a worklet cannot be called from one.
 */
function mixColor(rgb: [number, number, number], amt: number) {
  "worklet";
  const target = amt >= 0 ? 255 : 0;
  const p = Math.abs(amt);
  const ch = (v: number) => Math.round((target - v) * p + v);
  return Skia.Color((((255 << 24) | (ch(rgb[0]) << 16) | (ch(rgb[1]) << 8) | ch(rgb[2])) >>> 0));
}

/**
 * Roll timing, all of it owned by lib/moveTiming, so the animation and the
 * sync path's hold cannot drift apart and the rules stay testable in Node
 * (this file pulls in Skia and cannot be imported there).
 */

/** How far the phase runs while waiting: the give-up cap's worth of spinning,
 *  rounded up to a whole revolution so even the cap lands square to the camera. */
const MAX_WAIT_REVS = Math.ceil(DICE_MAX_ROLL_MS * DICE_SPIN_REV_PER_MS);
const MAX_WAIT_MS = MAX_WAIT_REVS / DICE_SPIN_REV_PER_MS;

/** The throw: how long the die takes to leave the table at the start of a roll. */
const RISE_MS = 180;

/** How far the roll wobbles off its two main axes. Rides a sine of the phase so
 *  it is exactly zero at every whole revolution — a wobble that did not vanish
 *  there would tilt the die at rest and undo the whole landing guarantee. */
const WOBBLE = 0.4;

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

/**
 * Memoized. Every prop is a primitive or a module-constant object (`theme` and
 * `skin` both resolve to catalog constants), so this holds on the re-renders
 * that matter: online, the game screen re-renders for chat, presence, lobby
 * and timer traffic, and each of those used to re-run the derived value below
 * — which is a full picture re-record — for a die that had not changed.
 */
export const Dice = memo(function Dice({ value, size = 64, spinSeq = 0, idle = false, theme, skin, onRollPress = null, pressLabel = "Roll the dice" }: DiceProps) {
  /**
   * The roll, as one number.
   *
   * `spin` is the phase in REVOLUTIONS and only ever climbs during a roll; every
   * axis below is an integer multiple of it, so a whole `spin` is the identity
   * rotation with the rolled face square to the camera. `settle` is 0 while the
   * cube is in the air and animates to 1 through the landing squash — it starts
   * at 1 so remounting at the next player's corner shows a resting die rather
   * than replaying a roll. `lift` is the throw, and is not rotation at all.
   */
  const spin = useSharedValue(0);
  const settle = useSharedValue(1);
  const lift = useSharedValue(0);
  /** Which way the die turns this roll, so consecutive rolls differ. */
  const spinDir = useSharedValue(1);
  const wiggle = useSharedValue(0);
  const mounted = useRef(false);
  const tappable = onRollPress !== null;

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

  /** The live `value`, mirrored during render so callbacks that fire long after
   *  their own render still read the current one. */
  const latestValue = useRef(value);
  latestValue.current = value;
  /** A roll is on screen: between the tap and the squash finishing. */
  const rolling = useRef(false);
  /** The landing arc has been started, so a second answer must not restart it. */
  const landing = useRef(false);
  /** The roll stopped without a number. Set only by the giving-up cap. */
  const gaveUp = useRef(false);
  /** Fires if the server never answers at all. */
  const capTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCap = useCallback(() => {
    if (capTimer.current) clearTimeout(capTimer.current);
    capTimer.current = null;
  }, []);

  /**
   * Bring the spin to rest on a whole revolution.
   *
   * The one place the roll changes character, and it does so without changing
   * speed: diceLandingMs sizes the arc so a cubic ease-out OPENS at exactly the
   * rate the die was already spinning at. That is the difference between a die
   * that slows down and a die that appears to be rolled a second time.
   *
   * `airborne` says the die is already up — it has been hovering through a wait
   * — so the landing only has to bring it down. A roll answered at the tap has
   * not left the table yet and throws first.
   */
  const beginLanding = useCallback(
    (airborne: boolean) => {
      if (landing.current) return;
      landing.current = true;
      clearCap();
      const from = spin.value;
      const ms = diceLandingMs(from);
      cancelAnimation(spin);
      spin.value = from;
      spin.value = withTiming(
        diceLandingTarget(from),
        { duration: ms, easing: Easing.out(Easing.cubic) },
        (finished) => {
          "worklet";
          if (!finished) return;
          settle.value = withTiming(1, { duration: DICE_SETTLE_MS });
          runOnJS(diceSettle)(); // impact, at the moment the cube stops turning
        },
      );
      cancelAnimation(lift);
      lift.value = airborne
        ? withTiming(0, { duration: ms, easing: Easing.in(Easing.quad) })
        : withSequence(
            withTiming(1, { duration: RISE_MS, easing: Easing.out(Easing.quad) }),
            withTiming(0, { duration: Math.max(ms - RISE_MS, 1), easing: Easing.in(Easing.quad) }),
          );
    },
    [spin, settle, lift, clearCap],
  );

  /**
   * Start a roll.
   *
   * With the number in hand this is the landing on its own — one revolution over
   * DICE_LANDING_MS, which is the tumble the die has always played offline.
   * Without it, the phase simply runs at a constant rate until an answer turns
   * up: no laps, no repeats, and nothing readable on the way (see
   * dieMath.tumbleFaceValue). The roll therefore lasts as long as the server
   * takes, which is what it looked like it should do all along.
   */
  const startRoll = useCallback(() => {
    playDiceRoll();
    // A die that is already rolling is not asking to be tapped. The roll leaves
    // `onRollPress` set for as long as the server takes to answer (the phase is
    // still awaiting-roll until then), so without this the whole canvas rocked
    // ±6° through the wait.
    stopWiggle();
    clearCap();
    rolling.current = true;
    landing.current = false;
    gaveUp.current = false;
    cancelAnimation(spin);
    cancelAnimation(lift);
    spin.value = 0;
    settle.value = 0;
    spinDir.value = spinDir.value * -1;

    if (latestValue.current !== null) {
      beginLanding(false);
      return;
    }
    lift.value = withTiming(1, { duration: RISE_MS, easing: Easing.out(Easing.quad) });
    spin.value = withTiming(MAX_WAIT_REVS, { duration: MAX_WAIT_MS, easing: Easing.linear });
    // Nothing is coming. Stop rather than spin at the player forever — a die
    // that never stops reads as a frozen app, and the store surfaces the
    // connection error alongside this.
    capTimer.current = setTimeout(() => {
      capTimer.current = null;
      gaveUp.current = true;
      beginLanding(true);
    }, DICE_MAX_ROLL_MS);
  }, [spin, settle, lift, spinDir, stopWiggle, clearCap, beginLanding]);

  // Start a roll when the store says one began.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!spinSeq) return;
    startRoll();
    return clearCap;
    // `value` is read through latestValue inside startRoll; this effect must NOT
    // re-run when it changes — that is the effect below, and restarting the roll
    // on a value change is the double-roll bug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinSeq, startRoll, clearCap]);

  // The answer arrived. Land on it — or, if the die has already given up and
  // stopped, roll again so the number arrives the way every number does rather
  // than materialising on a face that is sitting still.
  useEffect(() => {
    if (value === null) return;
    if (gaveUp.current) {
      gaveUp.current = false;
      startRoll();
      return;
    }
    if (rolling.current) beginLanding(true);
  }, [value, beginLanding, startRoll]);

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
  const fullMotion = useFullMotion();
  const sp = useMemo(() => {
    const base = diceRenderParams(skin, theme);
    if (fullMotion) return base;
    // The skin keeps its colours, gradient and pip shape — a player who paid
    // for obsidian still gets obsidian. What goes is the per-frame texture
    // work: the overlay regenerates a seeded scatter of dots and strokes on
    // every re-record, and each glow costs a blur mask filter. Both are detail
    // nobody reads on a 40px die, and both land during the settle squash.
    return { ...base, overlay: null, glow: null };
  }, [skin, theme, fullMotion]);

  /**
   * Everything the tumble draws with that does not change between frames.
   *
   * The picture below is re-recorded every frame — that is how a `<Picture>`
   * driven by a shared value works, and it is fine. What was NOT fine was
   * rebuilding the tools each time: seven `Skia.Paint()`s, a fresh
   * `MakeLinearGradient` per visible face (twice over, face then sheen), the
   * six cube faces, and a `Skia.Path` per face for numeral/shaped pips —
   * upwards of a hundred JSI objects a frame, at 60-120Hz, on the UI thread,
   * for 700ms a roll and up to nine seconds of it when an online roll is still
   * waiting on its number. On Hermes that is pure GC pressure landing on the
   * animation thread.
   *
   * None of it depends on the frame. It depends on the skin, which is `sp`.
   * So it is built once here and only mutated per frame — `setAlphaf` over a
   * cached shader gives exactly the value the per-frame gradient did, because
   * a paint's alpha modulates its shader's output.
   */
  const kit = useMemo(() => {
    const mix = mixColor;

    // Opaque black; the per-frame airborne fade rides on setAlphaf instead of
    // a fresh Skia.Color every frame.
    const shadow = Skia.Paint();
    shadow.setAntiAlias(true);
    shadow.setColor(Skia.Color("rgb(0, 0, 0)"));

    const core = Skia.Paint();
    core.setAntiAlias(true);
    core.setColor(sp.edgeRGB ? mix(sp.edgeRGB, 0) : mix(sp.faceRGB, -0.55));

    const facePaint = Skia.Paint();
    facePaint.setAntiAlias(true);

    const pipPaint = Skia.Paint();
    pipPaint.setAntiAlias(true);
    pipPaint.setColor(mix(sp.pipRGB, 0));

    // Same darker-rim trick as the landed face: a shaped pip is only a couple
    // of local units across here, so the outline — not the fill — is what
    // actually reads as a shape while the cube is spinning.
    const outlinePaint = Skia.Paint();
    outlinePaint.setAntiAlias(true);
    outlinePaint.setStyle(PaintStyle.Stroke);
    outlinePaint.setStrokeWidth(0.05);
    outlinePaint.setStrokeJoin(StrokeJoin.Round);
    outlinePaint.setColor(mix(sp.pipRGB, -0.45));

    const glossPaint = Skia.Paint();
    glossPaint.setAntiAlias(true);

    // Numeral skins ink a stroked centerline instead of a pip cluster; one
    // paint, restroked per pass (keyline then ink) for each visible face.
    const numeralPaint = Skia.Paint();
    numeralPaint.setAntiAlias(true);
    numeralPaint.setStyle(PaintStyle.Stroke);
    numeralPaint.setStrokeCap(StrokeCap.Round);
    numeralPaint.setStrokeJoin(StrokeJoin.Round);

    // Face-local, so the endpoints never move: one shader for every face of
    // every frame, with the per-face lambert term applied as paint alpha.
    const faceShader = sp.gradient
      ? Skia.Shader.MakeLinearGradient(
          { x: -1, y: -1 },
          { x: 1, y: 1 },
          sp.gradient.colors.map((cc) => Skia.Color(cc)),
          sp.gradient.stops,
          TileMode.Clamp,
        )
      : null;
    // Built at full white; the sheen strength and the face's own lambert term
    // multiply in through setAlphaf, which is what the per-frame rebuild did
    // by baking them into the gradient's own colors.
    const glossShader =
      sp.sheen > 0
        ? Skia.Shader.MakeLinearGradient(
            { x: -1, y: -1 },
            { x: -0.7, y: 0.45 },
            [Skia.Color("rgba(255,255,255,1)"), Skia.Color("rgba(255,255,255,0)")],
            null,
            TileMode.Clamp,
          )
        : null;

    // The six faces, arranged for each possible camera value (index = value-1).
    const facesFor = [1, 2, 3, 4, 5, 6].map((v) => cubeFaces(v));

    // Tumble-time pip geometry, one path per face value. Face-local units, so
    // a path is identical on every face that shows that value, on every frame.
    const pipPathFor: (ReturnType<typeof Skia.Path.Make> | null)[] = [1, 2, 3, 4, 5, 6].map((v) => {
      if (sp.pipShape === "dot") return null; // drawn as circles, no path
      const path = Skia.Path.Make();
      if (sp.pipShape === "numeral") {
        appendNumeral(path, v as Numeral, 0, 0, NUMERAL_FACE_R);
      } else {
        for (const [px, py] of PIP_XY[v]!) {
          appendPip(path, sp.pipShape, (px - 0.5) * 1.84, (py - 0.5) * 1.84, 0.19);
        }
      }
      return path;
    });

    // The "no number yet" mark, face-local and built once: a tumbling die that
    // is still waiting on the server wears this instead of a value. Stroked, so
    // it needs its own paint rather than the pip fill.
    const swirlPath = Skia.Path.Make();
    swirlPoints().forEach((pt, i) => {
      if (i === 0) swirlPath.moveTo(pt.x, pt.y);
      else swirlPath.lineTo(pt.x, pt.y);
    });
    const swirlPaint = Skia.Paint();
    swirlPaint.setAntiAlias(true);
    swirlPaint.setStyle(PaintStyle.Stroke);
    swirlPaint.setStrokeWidth(0.17); // the landed face's 0.085 of the die, in local units
    swirlPaint.setStrokeCap(StrokeCap.Round);
    swirlPaint.setStrokeJoin(StrokeJoin.Round);
    swirlPaint.setColor(mix(sp.pipRGB, 0));

    return {
      shadow,
      core,
      facePaint,
      pipPaint,
      outlinePaint,
      glossPaint,
      numeralPaint,
      swirlPath,
      swirlPaint,
      faceShader,
      glossShader,
      facesFor,
      pipPathFor,
      numeralKeyColor: mix(sp.pipRGB, -0.45),
      numeralInkColor: mix(sp.pipRGB, 0),
    };
  }, [sp]);


  /**
   * The landed face's frame-independent tools — the `kit` above, for the branch
   * `kit` never covered.
   *
   * The settle squash re-records this picture every frame for the last ~140ms
   * of a roll, and each of those frames was rebuilding the same paints, the
   * same gradient shader, and re-running `overlayArt`'s seeded PRNG scatter
   * from scratch. That is precisely the GC-pressure-on-the-UI-thread problem
   * documented on `kit`, arriving at the one moment the die is being watched.
   *
   * Only the unconditional, frame-independent pieces are hoisted. `ink` and the
   * numeral/motif/sheen paints deliberately stay inline: those are MUTATED down
   * conditional branches (the idle swirl restyles `ink` to a stroke), and a
   * shared paint carrying last frame's style into a branch that does not reset
   * it is a far worse bug than the allocation it would save.
   *
   * Geometry is included in the key because the gradient's endpoints are in
   * pixels; `size` is a prop and stable for the life of a render.
   */
  const landedKit = useMemo(() => {
    const mix = mixColor;
    const pad = Math.round(size * 0.65);
    const c = (size + pad * 2) / 2;
    const x = c - size / 2;
    const y = c - size / 2;
    const faceH = size - 3;

    const edge = Skia.Paint();
    edge.setAntiAlias(true);
    edge.setColor(sp.edgeRGB ? mix(sp.edgeRGB, 0) : mix(sp.faceRGB, -0.25));

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

    // Null when the skin has no overlay, which is also every skin on the
    // reduced motion tier — see `sp` above.
    const overlay = sp.overlay
      ? (() => {
          const dotPaint = Skia.Paint();
          dotPaint.setAntiAlias(true);
          dotPaint.setColor(mix(sp.pipRGB, 0));
          const strokePaint = Skia.Paint();
          strokePaint.setAntiAlias(true);
          strokePaint.setStyle(PaintStyle.Stroke);
          strokePaint.setStrokeCap(StrokeCap.Round);
          strokePaint.setColor(mix(sp.pipRGB, 0));
          return { art: overlayArt(sp.overlay, sp.overlaySeed), dotPaint, strokePaint };
        })()
      : null;

    return { edge, facePaint, overlay };
  }, [sp, size]);

  // Canvas is padded beyond the die so the mid-flight scale-up and the ground
  // shadow have room (corner-on at apex the cube's half-diagonal reaches
  // √3 · 1.3 · size/2 ≈ 1.13 · size/2); the layout footprint stays `size`.
  const pad = Math.round(size * 0.65);
  const canvasSide = size + pad * 2;
  const c = canvasSide / 2;
  // The cube has to be laid out around SOME face, so an unanswered roll still
  // arranges itself around a placeholder — that part is unavoidable and
  // harmless, because the arrangement is only geometry.
  const shownValue = value ?? 1;
  // What may actually be INKED onto those faces, which is a different question:
  // null until the server has answered. See tumbleFaceValue for why a lap that
  // never stops on the placeholder is still read as one.
  const inkValue = tumbleFaceValue(value);

  const picture = useDerivedValue(() => {
    const mix = mixColor;

    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, canvasSide, canvasSide));
    const phi = spin.value;
    const q = settle.value;
    // In the air until the landing arc has finished; the squash and the flat
    // face are the same beat, so one value says which half of the roll this is.
    const tumbling = q <= 0;
    const air = lift.value; // 0 grounded → 1 at throw height

    // Ground shadow: shrinks and fades while the die is airborne.
    const shadow = kit.shadow;
    shadow.setAlphaf(0.26 * (1 - air * 0.55));
    const shW = size * 0.5 * (1 - air * 0.3);
    const shH = size * 0.13 * (1 - air * 0.3);
    canvas.drawOval(Skia.XYWHRect(c - shW, c + size * 0.56 - shH, shW * 2, shH * 2), shadow);

    if (tumbling) {
      // EVERY AXIS IS AN INTEGER MULTIPLE OF THE SAME PHASE, which is what makes
      // the whole roll work: at any whole `phi` both angles are whole turns, so
      // the cube is at identity with the rolled face square to the camera. The
      // landing therefore only has to reach a whole number — it never has to
      // reach a particular MOMENT — and the wait can run as long as the server
      // needs without the die ever stopping anywhere it shouldn't.
      const ax = DICE_TURNS_X * 2 * Math.PI * phi;
      const ay = spinDir.value * DICE_TURNS_Y * 2 * Math.PI * phi;
      // Wobble, riding a sine of the phase so it is exactly zero at every whole
      // revolution. Anything that did not vanish there would leave the die
      // tilted at rest and undo the guarantee above.
      const az = WOBBLE * Math.sin(2 * Math.PI * phi);
      const h = (size / 2) * (1 + 0.3 * air); // grows toward the camera mid-flight

      // All of these were built here, every frame. They belong to the skin,
      // not the frame — see `kit`.
      const core = kit.core;
      const facePaint = kit.facePaint;
      const pipPaint = kit.pipPaint;
      const outlinePaint = kit.outlinePaint;
      const glossPaint = kit.glossPaint;
      const numeralPaint = kit.numeralPaint;

      // Cull faces nearly edge-on (they draw as stray hairline slivers).
      // One pass, and the cull happens BEFORE the other two axes are rotated:
      // the map/filter pair this replaces rotated all three vectors of all six
      // faces before throwing half of them away. (A scratch array reused
      // between frames would be better still, but Reanimated freezes the plain
      // objects a worklet captures, so the allocation has to live in here.)
      const visible: { face: (typeof kit.facesFor)[number][number]; n: Vec3; u: Vec3; v: Vec3 }[] = [];
      for (const face of kit.facesFor[shownValue - 1]!) {
        const n = rotateVec(face.n, ax, ay, az);
        if (n.z >= -0.06) continue;
        visible.push({ face, n, u: rotateVec(face.u, ax, ay, az), v: rotateVec(face.v, ax, ay, az) });
      }
      const visibleCount = visible.length;

      // Pass 1 — slightly oversized dark cores behind the faces, so the gaps
      // left by rounded face corners read as the die's darker edges. Core
      // rounding matches the faces so the silhouette stays curved — the
      // resting face rounds at 24% of its edge (see below), and local units
      // span 2 per edge, so 0.5 here is that same 24% scaled up 4%. Skipped
      // when the die is face-on (single face): there are no gaps to fill and
      // the core would show as a rim around the landing face.
      if (visibleCount > 1) {
        for (let i = 0; i < visibleCount; i++) {
          const { n, u, v } = visible[i]!;
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
      for (let i = 0; i < visibleCount; i++) {
        const { face, n, u, v } = visible[i]!;
        canvas.save();
        canvas.concat(Skia.Matrix(faceMatrix(u, v, n, h, c, c)));
        if (kit.faceShader) {
          facePaint.setShader(kit.faceShader);
          // The shader replaces per-face lambert shading, so fake back a hint
          // of it via alpha (modulates the shader's own output) — otherwise a
          // gradient skin's cube looks flat next to a solid-color one's.
          facePaint.setAlphaf(0.72 + 0.28 * lambert(n));
        } else {
          facePaint.setShader(null);
          facePaint.setColor(mix(sp.faceRGB, -0.46 + 0.62 * lambert(n)));
        }
        canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(-1, -1, 2, 2), 0.48, 0.48), facePaint);
        if (kit.glossShader) {
          // Scaled by the face's own lambert term so the cube's polish turns
          // with it, instead of every side glinting equally. The gradient runs
          // full white to clear, so this alpha reproduces exactly what baking
          // it into the gradient's colors used to.
          glossPaint.setShader(kit.glossShader);
          glossPaint.setAlphaf(sp.sheen * (0.35 + 0.65 * lambert(n)));
          canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(-1, -1, 2, 2), 0.48, 0.48), glossPaint);
        }
        // INK ONLY WHAT IS TRUE. Blank while the roll is still waiting on its
        // number, so the only face the player can ever read is a real one.
        //
        // This guard has been described here since c4450a5 and was never
        // actually written — the pips below were painted unconditionally, over
        // faces laid out around `value ?? 1`. Since every lap eases out to
        // camera-on, that is the whole of the "die lands on 1, then rolls again
        // and gets the actual number" report. A bare tumbling cube reads as a
        // die that is still going, which is exactly what it is.
        if (inkValue === null) {
          // Waiting on the server: the swirl, not a number and not nothing. See
          // dieMath.swirlPoints.
          canvas.drawPath(kit.swirlPath, kit.swirlPaint);
        } else {
          if (sp.pipShape === "dot") {
            for (const [px, py] of PIP_XY[face.value]!) {
              canvas.drawCircle((px - 0.5) * 1.84, (py - 0.5) * 1.84, 0.17, pipPaint);
            }
          } else if (sp.pipShape === "numeral") {
            // One figure per face, at the same cap height the landed face uses
            // (0.29 of the die, and a face spans 2 local units). Stroked, so the
            // rim trick above becomes a plain wider under-stroke rather than an
            // outline around a fill. The path is face-local, so it is the same
            // one on every face and every frame showing this value.
            const nr = NUMERAL_FACE_R;
            const numeral = kit.pipPathFor[face.value - 1]!;
            numeralPaint.setStrokeWidth(nr * NUMERAL_STROKE * NUMERAL_KEYLINE);
            numeralPaint.setColor(kit.numeralKeyColor);
            canvas.drawPath(numeral, numeralPaint);
            numeralPaint.setStrokeWidth(nr * NUMERAL_STROKE);
            numeralPaint.setColor(kit.numeralInkColor);
            canvas.drawPath(numeral, numeralPaint);
          } else {
            const facePips = kit.pipPathFor[face.value - 1]!;
            canvas.drawPath(facePips, outlinePaint);
            canvas.drawPath(facePips, pipPaint);
          }
        }
        canvas.restore();
      }
    } else {
      // Settled flat face with the landing squash (pivoting at the die's base).
      // The tap-me wiggle lives on the Canvas view's transform instead — inside
      // this recording it forced a full picture re-record every frame for as
      // long as the die was tappable, hogging the UI thread between turns.
      const squash = Math.sin(Math.PI * Math.min(q, 1));
      canvas.concat(Skia.Matrix(rotateScaleAbout(0, 1 + 0.07 * squash, 1 - 0.11 * squash, c, c + size / 2)));

      const x = c - size / 2;
      const y = c - size / 2;
      const rounded = size * 0.24;
      const faceH = size - 3;

      canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(x, y, size, size), rounded, rounded), landedKit.edge);

      const faceRRect = Skia.RRectXY(Skia.XYWHRect(x, y, size, faceH), rounded, rounded);
      canvas.drawRRect(faceRRect, landedKit.facePaint);

      // Overlay: a cheap deterministic texture pass (grain/veins/stars/facets),
      // clipped to the face. Recorded once per landing along with everything
      // else in this branch — the tumble never touches it.
      if (landedKit.overlay) {
        const { art, dotPaint, strokePaint } = landedKit.overlay;
        canvas.save();
        canvas.clipRRect(faceRRect, ClipOp.Intersect, true);
        for (const d of art.dots) {
          dotPaint.setAlphaf(d.a);
          canvas.drawCircle(x + d.x * size, y + d.y * faceH, d.r * size, dotPaint);
        }
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

      // Ornament: a struck figure behind the numeral, clipped to the face.
      // Drawn after the overlay texture (which says what the face is made of)
      // and before the gloss, so the polish sits over the decoration the way
      // a lacquer coat sits over an inlay.
      if (sp.motif) {
        const art = Skia.Path.Make();
        const mr = size * sp.motif.scale;
        appendMotif(art, sp.motif.kind, c, c - 1.5, mr);
        const style = motifStyle(sp.motif.kind);
        const paint = Skia.Paint();
        paint.setAntiAlias(true);
        paint.setColor(Skia.Color(sp.motif.color));
        paint.setAlphaf(sp.motif.alpha);
        if (style.style === "stroke") {
          paint.setStyle(PaintStyle.Stroke);
          paint.setStrokeWidth(style.width * mr);
        }
        canvas.save();
        canvas.clipRRect(faceRRect, ClipOp.Intersect, true);
        canvas.drawPath(art, paint);
        canvas.restore();
      }

      // Polished finish: a light sweep off the top-left of the face, fading out
      // by mid-face. This is what makes a bought die look bought — a flat
      // gradient reads as a printed color, the same face under a highlight
      // reads as lacquer, stone or metal with something over it. Matte skins
      // pass sheen 0 and skip the pass entirely, so the free die is untouched.
      if (sp.sheen > 0) {
        const gloss = Skia.Paint();
        gloss.setAntiAlias(true);
        gloss.setShader(
          Skia.Shader.MakeLinearGradient(
            { x, y },
            { x: x + size * 0.15, y: y + faceH * 0.72 },
            [
              Skia.Color(`rgba(255,255,255,${sp.sheen})`),
              Skia.Color(`rgba(255,255,255,${sp.sheen * 0.45})`),
              Skia.Color("rgba(255,255,255,0)"),
            ],
            [0, 0.38, 0.62],
            TileMode.Clamp,
          ),
        );
        canvas.save();
        canvas.clipRRect(faceRRect, ClipOp.Intersect, true);
        canvas.drawRRect(faceRRect, gloss);
        canvas.restore();

        // A lit rim just inside the face edge — the highlight a polished
        // surface catches all the way round, which is what stops the gloss
        // above reading as a smudge on a flat panel.
        const rim = Skia.Paint();
        rim.setAntiAlias(true);
        rim.setStyle(PaintStyle.Stroke);
        rim.setStrokeWidth(size * 0.028);
        rim.setColor(Skia.Color(`rgba(255,255,255,${sp.sheen * 0.42})`));
        const inset = size * 0.018;
        canvas.drawRRect(
          Skia.RRectXY(
            Skia.XYWHRect(x + inset, y + inset, size - inset * 2, faceH - inset * 2),
            rounded * 0.92,
            rounded * 0.92,
          ),
          rim,
        );
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
      } else if (sp.pipShape === "numeral") {
        // A single figure at the face's optical center (the same 1.5px lift
        // the swirl uses, since faceH is the die minus its edge lip). Three
        // passes over one path: the optional glow, a wider keyline in a darker
        // shade of the ink, then the ink itself — the stroked-centerline
        // equivalent of the outline-then-fill the shaped pips use below, and
        // it's what keeps a numeral crisp against its own face at ~48pt.
        const nr = size * (NUMERAL_FACE_R / 2); // face-local -> px: a face spans `size`
        const numeral = Skia.Path.Make();
        appendNumeral(numeral, shownValue as Numeral, c, c - 1.5, nr);
        const w = nr * NUMERAL_STROKE;

        const stroke = Skia.Paint();
        stroke.setAntiAlias(true);
        stroke.setStyle(PaintStyle.Stroke);
        stroke.setStrokeCap(StrokeCap.Round);
        stroke.setStrokeJoin(StrokeJoin.Round);

        // One path, stroked repeatedly from widest to narrowest, so each pass
        // survives only as a rim around the next. Nothing is clipped: a clip
        // would take the path's FILL, and an open centerline has no useful
        // fill — the ordering IS the containment.
        const pass = (width: number, color: ReturnType<typeof Skia.Color>, alpha: number, dy: number) => {
          stroke.setStrokeWidth(width);
          stroke.setColor(color);
          stroke.setAlphaf(alpha);
          canvas.save();
          canvas.translate(0, dy);
          canvas.drawPath(numeral, stroke);
          canvas.restore();
        };

        if (sp.glow) {
          stroke.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, size * 0.06, true));
          pass(w, Skia.Color(sp.glow), 1, 0);
          stroke.setMaskFilter(null);
        }
        // Keyline under everything: without it a gold figure on graphite or an
        // ivory one on jade loses its edge the moment the die is small.
        pass(w * NUMERAL_KEYLINE, mix(sp.pipRGB, -0.45), 1, 0);
        // Polished skins get a bevel — shaded below, lit above. This is the
        // difference between a numeral printed on the face and one struck into
        // it, and it is the tier's tell at arm's length (see DiceSkin.sheen).
        if (sp.sheen > 0) {
          pass(w * 1.22, mix(sp.pipRGB, -0.55), Math.min(1, sp.sheen * 1.3), nr * 0.055);
          pass(w * 1.22, mix(sp.pipRGB, 0.6), Math.min(1, sp.sheen * 1.5), -nr * 0.055);
        }
        pass(w, mix(sp.pipRGB, 0), 1, 0);
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
});
