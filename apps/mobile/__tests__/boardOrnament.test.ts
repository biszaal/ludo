/**
 * A preview must never show less board than the player would be buying.
 *
 * BoardSurface takes an `ornament` flag that drops the three generated art
 * layers — plate texture, frame band, yard emblems — on the reduced motion
 * tier. That is a fair cut inside a match: it costs a weak phone real JS time
 * to generate the geometry before the first board paint, and what identifies a
 * paid theme (its colours, gradient, team palette, cell fills, glyph and centre
 * crest) is untouched.
 *
 * It stops being fair the moment it reaches a shop swatch, the customize
 * locker, the hub's hero diorama or the how-to-play art. Those surfaces exist
 * to show a player what a board looks like, and one that quietly shows a
 * cheaper board on a cheaper phone is selling something it is not displaying.
 *
 * So the flag defaults to ON and exactly one caller is allowed to pass it: the
 * in-game board. This is parsed from source rather than rendered because the
 * property being guarded is "who is allowed to ask for this", which is a fact
 * about the call sites, not about any one render.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "src");

/** The only file permitted to turn ornament off, relative to src/. */
const IN_GAME_BOARD = join("components", "Board.tsx");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Every `<BoardSurface ... />` element in a file, as raw text. */
function boardSurfaceElements(text: string): string[] {
  return [...text.matchAll(/<BoardSurface\b[^>]*\/>/g)].map((m) => m[0]);
}

describe("BoardSurface ornament stays in the game", () => {
  it("is passed by the in-game board and by nobody else", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const rel = file.slice(SRC.length + 1);
      if (rel === IN_GAME_BOARD) continue;
      for (const el of boardSurfaceElements(readFileSync(file, "utf8"))) {
        if (/\bornament\b/.test(el)) offenders.push(`${rel}: ${el}`);
      }
    }

    // A preview that opts into the reduced plate is the failure this guards.
    expect(offenders).toEqual([]);
  });

  it("still has the in-game board driving it from the motion tier", () => {
    const text = readFileSync(join(SRC, IN_GAME_BOARD), "utf8");
    const els = boardSurfaceElements(text).filter((el) => /\bornament\b/.test(el));

    expect(els).toHaveLength(1);
    expect(els[0]).toMatch(/ornament=\{fullMotion\}/);
  });

  it("leaves the flag defaulting to the full treatment", () => {
    const text = readFileSync(join(SRC, IN_GAME_BOARD), "utf8");
    // An `ornament?: boolean` that defaulted to false — or to undefined, which
    // is falsy — would strip every preview in the app without one call site
    // changing.
    expect(text).toMatch(/ornament = true/);
  });
});
