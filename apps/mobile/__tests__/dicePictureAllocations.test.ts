/**
 * The die's picture worklet must not build Skia objects it could build once.
 *
 * `picture` is a useDerivedValue that re-records the whole die on every frame
 * any of its shared values moves: ~67 frames of tumble and ~17 frames of settle
 * squash per roll at 120Hz, inside an 8.3ms budget. Every Paint, Path, Shader,
 * MaskFilter or RRect constructed in there is a native allocation repeated on
 * each of those frames, and on 1.1.1 that was enough to make the spin judder on
 * a 120Hz Galaxy while every slower motion in the game stayed smooth.
 *
 * Anything that depends only on the skin and the size belongs in `kit` or
 * `landedKit`, built once per skin. This test reads the worklet's source and
 * pins that, because a regression here is invisible in review and on a 60Hz
 * simulator — it only shows up as a feel on the fastest phones.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("../src/components/Dice.tsx", import.meta.url)), "utf8");

/** The body of the per-frame picture worklet, with line comments removed. */
function pictureWorklet(): string {
  const start = source.indexOf("const picture = useDerivedValue(() => {");
  const end = source.indexOf("return rec.finishRecordingAsPicture();", start);
  expect(start, "picture worklet not found — was it renamed?").toBeGreaterThan(-1);
  expect(end, "picture worklet end not found").toBeGreaterThan(start);
  return source.slice(start, end).replace(/\/\/.*$/gm, "");
}

const count = (body: string, needle: string) => body.split(needle).length - 1;

describe("Dice picture worklet allocations", () => {
  it("builds no paints, paths, shaders or blur filters per frame", () => {
    const body = pictureWorklet();
    expect(count(body, "Skia.Paint(")).toBe(0);
    expect(count(body, "Skia.Path.Make(")).toBe(0);
    expect(count(body, "Skia.Shader.")).toBe(0);
    expect(count(body, "Skia.MaskFilter.")).toBe(0);
  });

  it("builds no rounded rects per frame", () => {
    expect(count(pictureWorklet(), "Skia.RRectXY(")).toBe(0);
  });

  it("builds only the two rects that genuinely change every frame", () => {
    // The recording bounds, and the ground shadow — which shrinks with the
    // die's height, so it cannot be hoisted.
    expect(count(pictureWorklet(), "Skia.XYWHRect(")).toBe(2);
  });
});
