/**
 * Numeral glyphs for the digit dice — the gem-tier "Numerals" line shows a
 * single large figure on each face instead of a cluster of pips.
 *
 * Hand-built CENTERLINE paths, stroked rather than filled. Two reasons, both
 * load-bearing:
 *
 *  - No font. These are drawn inside Dice.tsx's per-frame Skia recording on
 *    the UI thread, where an async-loaded SkFont is not available and would
 *    have to be threaded through a shared value. Path geometry is worklet-safe
 *    and dependency-free, exactly like pipShapes.ts, so it also unit-tests in
 *    plain Node.
 *  - A monoline stroke is the look. At the die's real size (~48pt) a filled
 *    display numeral turns into a blob; an even-weight geometric stroke stays
 *    legible and reads as an engraved dial figure, which is the whole point of
 *    the tier.
 *
 * Same worklet discipline as pipShapes.ts: this function calls no sibling
 * top-level function in this file (Reanimated's transform loses plain JS
 * hoisting, so a same-file worklet→worklet call can resolve to undefined in
 * the real Metro bundle while every vitest run passes).
 */

/** The subset of SkPath these glyphs need — a real SkPath satisfies it. */
export interface NumeralSink {
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): unknown;
}

/** Die faces only ever show 1..6. */
export type Numeral = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Stroke width that suits these centerlines, as a multiple of `r`. Callers
 * pass `r * NUMERAL_STROKE` to `setStrokeWidth` (round cap AND round join —
 * the glyphs rely on both to close their corners).
 */
export const NUMERAL_STROKE = 0.33;

/**
 * The keyline pass under the ink, as a multiple of the ink stroke width. A
 * numeral sits directly on its own face with no pip-sized gap around it, so
 * without a darker under-stroke a gold figure on graphite or an ivory one on
 * jade loses its edge the moment the die is small or moving. Shared by every
 * surface that draws a numeral so they cannot drift apart.
 */
export const NUMERAL_KEYLINE = 1.5;

/**
 * Cap-height radius for a numeral filling a die face, in FACE-LOCAL units —
 * the coordinate space Dice.tsx's projected faces and DiceSwatch's cube both
 * draw in, where a face spans [-1, 1]. In pixels on a flat die that is the
 * same figure as `size * 0.29`, since a face there spans `size` across two
 * local units.
 *
 * Sized so the glyph plus its keyline clears the face's rounded corners with
 * room to spare (pinned by __tests__/dieNumerals.test.ts) while still filling
 * the face the way a dial figure should — a numeral that keeps a pip-sized
 * margin just reads as a small number printed on a big square.
 */
export const NUMERAL_FACE_R = 0.58;

/**
 * Appends the centerline of `digit` centered on (cx, cy) into `sink`, drawn at
 * a cap height of 2r. Every control point stays within 0.58r horizontally and
 * 1.1r vertically of the center, so at the default stroke weight the inked
 * glyph fits a box of about 1.5r x 2.4r — callers size the face against that,
 * not against r alone.
 */
export function appendNumeral(sink: NumeralSink, digit: Numeral, cx: number, cy: number, r: number): void {
  "worklet";
  const X = (u: number) => cx + u * r;
  const Y = (v: number) => cy + v * r;

  switch (digit) {
    case 1: {
      // Flag, stem, and a full foot bar — the foot is what stops a lone stem
      // reading as an I, and it balances the die's optical center.
      sink.moveTo(X(-0.34), Y(-0.54));
      sink.lineTo(X(0.02), Y(-0.94));
      sink.lineTo(X(0.02), Y(0.94));
      sink.moveTo(X(-0.4), Y(0.94));
      sink.lineTo(X(0.44), Y(0.94));
      return;
    }
    case 2: {
      sink.moveTo(X(-0.5), Y(-0.52));
      sink.cubicTo(X(-0.46), Y(-1.02), X(0.52), Y(-1.06), X(0.5), Y(-0.42));
      sink.cubicTo(X(0.48), Y(-0.04), X(-0.06), Y(0.34), X(-0.52), Y(0.92));
      sink.lineTo(X(0.54), Y(0.92));
      return;
    }
    case 3: {
      sink.moveTo(X(-0.44), Y(-0.62));
      sink.cubicTo(X(-0.18), Y(-1.04), X(0.52), Y(-0.94), X(0.48), Y(-0.46));
      sink.cubicTo(X(0.45), Y(-0.14), X(0.12), Y(-0.04), X(-0.12), Y(-0.04));
      sink.cubicTo(X(0.18), Y(-0.04), X(0.56), Y(0.1), X(0.54), Y(0.48));
      sink.cubicTo(X(0.52), Y(1.0), X(-0.22), Y(1.1), X(-0.48), Y(0.66));
      return;
    }
    case 4: {
      sink.moveTo(X(0.24), Y(-0.94));
      sink.lineTo(X(-0.52), Y(0.34));
      sink.lineTo(X(0.56), Y(0.34));
      sink.moveTo(X(0.24), Y(-0.94));
      sink.lineTo(X(0.24), Y(0.94));
      return;
    }
    case 5: {
      sink.moveTo(X(0.44), Y(-0.9));
      sink.lineTo(X(-0.38), Y(-0.9));
      sink.lineTo(X(-0.44), Y(-0.18));
      sink.cubicTo(X(-0.06), Y(-0.44), X(0.56), Y(-0.24), X(0.54), Y(0.36));
      sink.cubicTo(X(0.52), Y(0.98), X(-0.2), Y(1.1), X(-0.48), Y(0.7));
      return;
    }
    case 6: {
      sink.moveTo(X(0.4), Y(-0.86));
      sink.cubicTo(X(-0.06), Y(-1.02), X(-0.5), Y(-0.56), X(-0.5), Y(0.26));
      sink.cubicTo(X(-0.5), Y(0.9), X(-0.06), Y(1.1), X(0.2), Y(0.9));
      sink.cubicTo(X(0.54), Y(0.64), X(0.52), Y(0.1), X(0.1), Y(0.02));
      sink.cubicTo(X(-0.2), Y(-0.04), X(-0.44), Y(0.1), X(-0.5), Y(0.26));
      return;
    }
  }
}
