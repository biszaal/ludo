/**
 * A die at rest as a small 3D cube — three faces on show, drawn with the same
 * dieMath projection Dice.tsx tumbles with, at a fixed rest angle.
 *
 * Shared by every surface that advertises a skin rather than plays with it:
 * the Shop/Customize grid tile (DiceSwatch) and the Premium rail's showcase
 * card. Having ONE of these is the point. Both surfaces used to draw their own
 * flat square, and a flat square was already lying about the marking-based
 * skins — a numeral die shows one figure per face, so a single-face preview
 * advertises a third of the skin, and the rail's version (DieStill) drew flat
 * dots in the face's first gradient color no matter what the skin actually
 * inked. A cube shows the face treatment, the edge, the frame, the finish and
 * three marks at once, and it costs nothing at runtime: one Picture, recorded
 * per skin, never animated.
 *
 * DieStill.tsx is deliberately left alone — it is scene furniture in the hero
 * diorama, not a preview of anything a player can buy.
 *
 * The decorative face overlay (grain/veins/stars/facets) is skipped here on
 * purpose: at this size it would be a few near-invisible flecks. It is the
 * payoff for playing with the skin equipped; a preview only needs to sell
 * color, mark and finish.
 */

import { useMemo } from "react";
import {
  BlurStyle,
  Canvas,
  ClipOp,
  PaintStyle,
  Picture,
  Skia,
  StrokeCap,
  StrokeJoin,
  TileMode,
  type SkPicture,
} from "@shopify/react-native-skia";
import { diceRenderParams, type DiceSkin } from "../render/diceSkins";
import { cubeFaces, faceMatrix, lambert, rotateVec } from "../render/dieMath";
import { appendNumeral, NUMERAL_FACE_R, NUMERAL_KEYLINE, NUMERAL_STROKE, type Numeral } from "../render/dieNumerals";
import { appendMotif, motifStyle } from "../render/faceMotifs";
import { appendPip } from "../render/pipShapes";
import { shade } from "../theme";

/** The rest angle. Tilted enough to read as a solid, not so far that the
 *  camera face stops being the one you look at first. */
const AX = 0.42;
const AY = 0.52;

/** Value shown toward the camera; the other two follow from a standard die
 *  (opposite faces sum to 7), so a cube always reads 1 / 2 / 3. */
const FRONT = 1;

/** Pip centers on a unit face, per die value — mirrors Dice.tsx's PIP_XY (each
 *  Skia die-face surface keeps its own small copy; see DieStill.tsx too). */
const PIP_XY: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.26, 0.26], [0.74, 0.74]],
  3: [[0.26, 0.26], [0.5, 0.5], [0.74, 0.74]],
  4: [[0.26, 0.26], [0.74, 0.26], [0.26, 0.74], [0.74, 0.74]],
  5: [[0.26, 0.26], [0.74, 0.26], [0.5, 0.5], [0.26, 0.74], [0.74, 0.74]],
  6: [[0.26, 0.22], [0.74, 0.22], [0.26, 0.5], [0.74, 0.5], [0.26, 0.78], [0.74, 0.78]],
};

/** Records the cube for `skin` into a `size` x `size` picture. */
function dieCubePicture(skin: DiceSkin, size: number): SkPicture {
  // Half-edge of the cube, and where it sits. Sized so the corner-on
  // silhouette clears the canvas with room for the contact shadow.
  const H = size * 0.3;
  const cx = size / 2;
  const cy = size / 2 + size * 0.02;

  // DEFAULT_DIE, not the board theme. Classic used to fall back to
  // `theme.dice`, which made the shop tile for the plain white die repaint
  // itself walnut-brown or slate-blue the moment you previewed another board —
  // a skin advertising a color it does not have. diceRenderParams resolves
  // that fallback now, and ignores the theme entirely.
  const sp = diceRenderParams(skin);
  const hex = (rgb: [number, number, number]) =>
    `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
  const faceHex = hex(sp.faceRGB);
  const pipHex = hex(sp.pipRGB);
  const edgeHex = sp.edgeRGB ? hex(sp.edgeRGB) : shade(faceHex, -0.4);
  // A darker rim under the mark (mirrors Dice.tsx): at this size it is the
  // rim, not the fill color, that makes a numeral or a shaped pip read as
  // anything other than a blob.
  const keyHex = shade(pipHex, -0.45);

  const rec = Skia.PictureRecorder();
  const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, size, size));

  const shadow = Skia.Paint();
  shadow.setAntiAlias(true);
  shadow.setColor(Skia.Color("rgba(0,0,0,0.30)"));
  canvas.drawOval(Skia.XYWHRect(cx - H * 0.95, cy + H * 1.01, H * 1.9, H * 0.48), shadow);

  const visible = cubeFaces(FRONT)
    .map((face) => ({
      face,
      n: rotateVec(face.n, AX, AY, 0),
      u: rotateVec(face.u, AX, AY, 0),
      v: rotateVec(face.v, AX, AY, 0),
    }))
    // Cull faces nearly edge-on (they draw as stray hairline slivers).
    .filter(({ n }) => n.z < -0.06);

  // Pass 1 — oversized dark cores behind the faces, so the wedges left by the
  // rounded face corners read as the die's own edges instead of as a gap
  // between three separate tiles. 1.17 with a tighter corner is what it takes
  // to close the seam at THIS angle; Dice.tsx's tumble uses a smaller
  // overscale because a face nearly edge-on needs less filling in.
  const core = Skia.Paint();
  core.setAntiAlias(true);
  core.setColor(Skia.Color(edgeHex));
  for (const { n, u, v } of visible) {
    canvas.save();
    canvas.concat(Skia.Matrix(faceMatrix(u, v, n, H, cx, cy)));
    canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(-1.17, -1.17, 2.34, 2.34), 0.4, 0.4), core);
    canvas.restore();
  }

  // Pass 2 — the lit faces and their marks, in face-local coordinates that the
  // same matrix foreshortens.
  const facePaint = Skia.Paint();
  facePaint.setAntiAlias(true);
  const markFill = Skia.Paint();
  markFill.setAntiAlias(true);
  markFill.setColor(Skia.Color(pipHex));
  const gloss = Skia.Paint();
  gloss.setAntiAlias(true);
  const rim = Skia.Paint();
  rim.setAntiAlias(true);
  rim.setStyle(PaintStyle.Stroke);
  rim.setStrokeWidth(0.055);

  const faceRect = Skia.RRectXY(Skia.XYWHRect(-1, -1, 2, 2), 0.48, 0.48);

  for (const { face, n, u, v } of visible) {
    canvas.save();
    canvas.concat(Skia.Matrix(faceMatrix(u, v, n, H, cx, cy)));

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
      // The shader replaces per-face lambert shading, so fake back a hint of it
      // via alpha — otherwise a gradient skin's cube looks flat next to a
      // solid-color one's.
      facePaint.setAlphaf(0.72 + 0.28 * lambert(n));
    } else {
      facePaint.setShader(null);
      facePaint.setAlphaf(1);
      facePaint.setColor(Skia.Color(shade(faceHex, -0.46 + 0.62 * lambert(n))));
    }
    canvas.drawRRect(faceRect, facePaint);

    // Ornament behind the numeral, clipped to the face. `scale` is a fraction
    // of the die's WIDTH, and a face spans 2 local units, hence the doubling.
    if (sp.motif) {
      const art = Skia.Path.Make();
      const mr = sp.motif.scale * 2;
      appendMotif(art, sp.motif.kind, 0, 0, mr);
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
      canvas.clipRRect(faceRect, ClipOp.Intersect, true);
      canvas.drawPath(art, paint);
      canvas.restore();
    }

    // Polished finish — the gem tier's tell (see DiceSkin.sheen). Scaled by the
    // face's own lambert term so the cube's polish turns with it instead of
    // every side glinting equally. Matte skins skip the pass entirely, so the
    // free die's preview is exactly what it always was.
    if (sp.sheen > 0) {
      const a = sp.sheen * (0.35 + 0.65 * lambert(n));
      gloss.setShader(
        Skia.Shader.MakeLinearGradient(
          { x: -1, y: -1 },
          { x: -0.7, y: 0.45 },
          [
            Skia.Color(`rgba(255,255,255,${a})`),
            Skia.Color(`rgba(255,255,255,${a * 0.45})`),
            Skia.Color("rgba(255,255,255,0)"),
          ],
          [0, 0.38, 0.62],
          TileMode.Clamp,
        ),
      );
      canvas.drawRRect(faceRect, gloss);

      // A lit rim just inside the face edge — the highlight a polished surface
      // catches all the way round, which is what stops the gloss above reading
      // as a smudge on a flat panel.
      rim.setColor(Skia.Color(`rgba(255,255,255,${sp.sheen * 0.42})`));
      canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(-0.965, -0.965, 1.93, 1.93), 0.45, 0.45), rim);
    }

    if (sp.frame) {
      const frame = Skia.Paint();
      frame.setAntiAlias(true);
      frame.setStyle(PaintStyle.Stroke);
      frame.setStrokeWidth(0.09);
      frame.setColor(Skia.Color(sp.frame));
      canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(-0.955, -0.955, 1.91, 1.91), 0.44, 0.44), frame);
    }

    if (sp.pipShape === "numeral") {
      const nr = NUMERAL_FACE_R;
      const numeral = Skia.Path.Make();
      appendNumeral(numeral, face.value as Numeral, 0, 0, nr);
      const w = nr * NUMERAL_STROKE;

      const stroke = Skia.Paint();
      stroke.setAntiAlias(true);
      stroke.setStyle(PaintStyle.Stroke);
      stroke.setStrokeCap(StrokeCap.Round);
      stroke.setStrokeJoin(StrokeJoin.Round);

      // One path, stroked repeatedly from widest to narrowest, so each pass
      // survives only as a rim around the next. Nothing is clipped: a clip
      // would take the path's FILL, and an open centerline has no useful fill
      // — the ordering IS the containment. Mirrors Dice.tsx's landed face.
      const pass = (width: number, color: string, alpha: number, dy: number) => {
        stroke.setStrokeWidth(width);
        stroke.setColor(Skia.Color(color));
        stroke.setAlphaf(alpha);
        canvas.save();
        canvas.translate(0, dy);
        canvas.drawPath(numeral, stroke);
        canvas.restore();
      };

      if (sp.glow) {
        stroke.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 0.12, true));
        pass(w, sp.glow, 1, 0);
        stroke.setMaskFilter(null);
      }
      pass(w * NUMERAL_KEYLINE, keyHex, 1, 0);
      // Shaded below, lit above: a numeral struck into the face rather than
      // printed on it (see DiceSkin.sheen).
      if (sp.sheen > 0) {
        pass(w * 1.22, shade(pipHex, -0.55), Math.min(1, sp.sheen * 1.3), nr * 0.055);
        pass(w * 1.22, shade(pipHex, 0.6), Math.min(1, sp.sheen * 1.5), -nr * 0.055);
      }
      pass(w, pipHex, 1, 0);
        } else if (sp.pipShape === "dot") {
      for (const [px, py] of PIP_XY[face.value]!) {
        canvas.drawCircle((px - 0.5) * 1.84, (py - 0.5) * 1.84, 0.17, markFill);
      }
    } else {
      const pips = Skia.Path.Make();
      for (const [px, py] of PIP_XY[face.value]!) {
        appendPip(pips, sp.pipShape, (px - 0.5) * 1.84, (py - 0.5) * 1.84, 0.19);
      }
      if (sp.glow) {
        const glowPaint = Skia.Paint();
        glowPaint.setAntiAlias(true);
        glowPaint.setColor(Skia.Color(sp.glow));
        glowPaint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 0.12, true));
        canvas.drawPath(pips, glowPaint);
      }
      const outline = Skia.Paint();
      outline.setAntiAlias(true);
      outline.setStyle(PaintStyle.Stroke);
      outline.setStrokeWidth(0.06);
      outline.setStrokeJoin(StrokeJoin.Round);
      outline.setColor(Skia.Color(keyHex));
      canvas.drawPath(pips, outline);
      canvas.drawPath(pips, markFill);
    }

    canvas.restore();
  }

  return rec.finishRecordingAsPicture();
}

/** The cube on its own canvas, for callers that just want to drop one in. */
export function DieCube({ skin, size }: { skin: DiceSkin; size: number }) {
  const picture = useMemo(() => dieCubePicture(skin, size), [skin, size]);
  return (
    <Canvas style={{ width: size, height: size }}>
      <Picture picture={picture} />
    </Canvas>
  );
}
