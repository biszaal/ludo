/**
 * Guards the Board.tsx color extraction: "classic" must equal the exact
 * literals the board originally hardcoded, and every theme must fully define
 * every surface (a missing color would render Skia's default black).
 */

import { describe, it, expect } from "vitest";
import { BOARD_THEMES, DEFAULT_THEME } from "../src/render/boardThemes";
import { palette, teamColor } from "../src/theme";

describe("board themes", () => {
  it("classic matches the original board literals exactly", () => {
    const c = BOARD_THEMES.classic;
    expect(c.boardBase).toBe("#FDFDFB");
    expect(c.boardEdge).toBe("#B9B2A0");
    expect(c.cellFill).toBe("#FFFFFF");
    expect(c.cellBorder).toBe("#D2D2D2");
    expect(c.starColor).toBe("#AEB4BD");
    expect(c.team).toEqual(teamColor);
    expect(c.dice).toEqual({ face: palette.liftedSlate, pip: palette.porcelain });
    expect(c.pawnStroke).toBe("rgba(0,0,0,0.32)");
  });

  it("classic is the default theme", () => {
    expect(DEFAULT_THEME).toBe(BOARD_THEMES.classic);
  });

  it("every theme fully defines every surface", () => {
    for (const [key, t] of Object.entries(BOARD_THEMES)) {
      expect(t.id).toBe(key);
      expect(t.label.length).toBeGreaterThan(0);
      for (const v of [t.boardBase, t.boardEdge, t.cellFill, t.cellBorder, t.starColor, t.pawnStroke, t.dice.face, t.dice.pip]) {
        expect(v).toMatch(/^(#[0-9A-Fa-f]{6}|rgba?\()/);
      }
      for (const color of ["red", "green", "yellow", "blue"] as const) {
        expect(t.team[color]).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });

  it("theme ids are the four skins, uniquely keyed", () => {
    expect(Object.keys(BOARD_THEMES).sort()).toEqual(["classic", "night", "sand", "walnut"]);
  });
});
