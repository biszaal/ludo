/**
 * Ornamental face art for the top dice tier — a rosette of petals, engine-turned
 * guilloché, an Art Deco sunburst. Drawn behind the numeral, clipped to the
 * face, in the skin's own accent color.
 *
 * This is a step up from pipShapes.ts's `overlayArt`, and deliberately a
 * separate thing rather than more OverlayKinds. An overlay is a texture: a
 * scatter of dots and short strokes that says what a face is MADE of (wood
 * grain, marble veining, star flecks). A motif is a figure: real ornament with
 * a center, symmetry and a repeat count, which says the face was DECORATED.
 * They compose — a skin can carry both — and they need different machinery,
 * because a texture wants a seeded PRNG and ornament wants exact symmetry.
 * Randomising ornament is what makes it look like damage instead of design,
 * which is the same lesson pipShapes.ts's "facets" comment already records.
 *
 * Same worklet discipline as pipShapes.ts and dieNumerals.ts: every exported
 * function is self-contained and calls no sibling top-level function in this
 * file (Reanimated's transform loses plain JS hoisting, so a same-file
 * worklet-to-worklet call can resolve to undefined in the real Metro bundle
 * while every vitest run passes). Pure geometry, no dependencies, unit-testable
 * in Node.
 */

export type MotifKind = "rosette" | "guilloche" | "deco";

/** The subset of SkPath these motifs need — a real SkPath satisfies it. */
export interface MotifSink {
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): unknown;
  close(): unknown;
}

/**
 * How each motif wants to be painted. Ornament that reads as engraving is
 * stroked at a hairline; ornament that reads as inlay is filled. Callers scale
 * `width` by the same `r` they passed to appendMotif.
 */
export function motifStyle(kind: MotifKind): { style: "fill" | "stroke"; width: number } {
  "worklet";
  // Guilloché is engine-turning — cut lines in metal, so a hairline stroke.
  // The other two are inlay: petals and rays laid into the face as shapes.
  return kind === "guilloche" ? { style: "stroke", width: 0.045 } : { style: "fill", width: 0 };
}

/**
 * Appends `kind` centered on (cx, cy) at radius `r` into `sink`.
 *
 * Everything stays within 1.0r of the center, so a caller drawing at r = the
 * face half-width fills the face edge to edge. Nothing here is seeded: these
 * are symmetric figures, and a figure whose repeat count or angles wobble at
 * random stops reading as ornament.
 */
export function appendMotif(sink: MotifSink, kind: MotifKind, cx: number, cy: number, r: number): void {
  "worklet";
  const TAU = Math.PI * 2;

  switch (kind) {
    case "rosette": {
      // Eight petals from a small core out to the rim — a bloom the numeral
      // sits in the middle of. Each petal is two mirrored cubics, so the tip
      // comes to a point and the flanks stay convex.
      const petals = 8;
      const base = 0.17;
      const tip = 0.99;
      const flare = 0.3; // half-width of a petal, in radians
      for (let i = 0; i < petals; i++) {
        const a = -Math.PI / 2 + (i / petals) * TAU;
        const px = (rad: number, ang: number) => cx + Math.cos(ang) * rad * r;
        const py = (rad: number, ang: number) => cy + Math.sin(ang) * rad * r;
        sink.moveTo(px(base, a), py(base, a));
        sink.cubicTo(
          px(0.55, a - flare), py(0.55, a - flare),
          px(0.9, a - flare * 0.5), py(0.9, a - flare * 0.5),
          px(tip, a), py(tip, a),
        );
        sink.cubicTo(
          px(0.9, a + flare * 0.5), py(0.9, a + flare * 0.5),
          px(0.55, a + flare), py(0.55, a + flare),
          px(base, a), py(base, a),
        );
        sink.close();
      }
      return;
    }

    case "guilloche": {
      // Engine turning: concentric rings with a ring of fine radial cuts
      // between the outer two — the pattern on a watch dial or a banknote.
      const K = 0.5523; // circle-from-cubics constant
      for (const ring of [0.98, 0.7, 0.34]) {
        const rr = ring * r;
        sink.moveTo(cx, cy - rr);
        sink.cubicTo(cx + K * rr, cy - rr, cx + rr, cy - K * rr, cx + rr, cy);
        sink.cubicTo(cx + rr, cy + K * rr, cx + K * rr, cy + rr, cx, cy + rr);
        sink.cubicTo(cx - K * rr, cy + rr, cx - rr, cy + K * rr, cx - rr, cy);
        sink.cubicTo(cx - rr, cy - K * rr, cx - K * rr, cy - rr, cx, cy - rr);
        sink.close();
      }
      const cuts = 24;
      for (let i = 0; i < cuts; i++) {
        const a = (i / cuts) * TAU;
        sink.moveTo(cx + Math.cos(a) * 0.7 * r, cy + Math.sin(a) * 0.7 * r);
        sink.lineTo(cx + Math.cos(a) * 0.98 * r, cy + Math.sin(a) * 0.98 * r);
      }
      return;
    }

    case "deco": {
      // A sunburst of tapered rays, alternating long and short — the fan that
      // says Deco faster than any other single figure.
      const rays = 24;
      const half = (TAU / rays) * 0.42; // angular half-width of a ray
      const inner = 0.26;
      for (let i = 0; i < rays; i++) {
        const a = -Math.PI / 2 + (i / rays) * TAU;
        const outer = i % 2 === 0 ? 1.0 : 0.64;
        const pt = (rad: number, ang: number): [number, number] => [
          cx + Math.cos(ang) * rad * r,
          cy + Math.sin(ang) * rad * r,
        ];
        // Widest at the core, tapering to a point at the rim — beams thrown
        // outward. The reverse (wide at the rim) is the same four points in a
        // different order and reads as a cog, which is what this used to do.
        const a0 = pt(inner, a - half);
        const a1 = pt(outer, a - half * 0.16);
        const a2 = pt(outer, a + half * 0.16);
        const a3 = pt(inner, a + half);
        sink.moveTo(a0[0], a0[1]);
        sink.lineTo(a1[0], a1[1]);
        sink.lineTo(a2[0], a2[1]);
        sink.lineTo(a3[0], a3[1]);
        sink.close();
      }
      return;
    }
  }
}
