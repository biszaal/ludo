/**
 * Guards the Board.tsx color extraction: "classic" must equal the exact
 * literals the board originally hardcoded, and every theme must fully define
 * every surface (a missing color would render Skia's default black).
 *
 * Also guards the premium tiers added in 0061: their optional treatments have
 * to be well-formed (a malformed gradient stop or an out-of-range sheen is a
 * black plate, not a warning), the four original themes must not have quietly
 * acquired any of them, and every theme's price/currency must match the catalog
 * row that actually sells it.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { BOARD_THEMES, DEFAULT_THEME, resolveBoardTheme, type BoardTheme } from "../src/render/boardThemes";
import { teamColor } from "../src/theme";

const COLOR = /^(#[0-9A-Fa-f]{6}|rgba?\()/;

/** The themes that shipped before the premium tiers — none may be restyled. */
const ORIGINAL = ["classic", "night", "walnut", "sand", "aurora"] as const;

describe("board themes", () => {
  it("classic matches the original board literals exactly", () => {
    const c = BOARD_THEMES.classic;
    expect(c.boardBase).toBe("#FDFDFB");
    expect(c.boardEdge).toBe("#B9B2A0");
    expect(c.cellFill).toBe("#FFFFFF");
    expect(c.slotEmpty).toBe("#C6CBD1");
    expect(c.cellBorder).toBe("#D2D2D2");
    expect(c.starColor).toBe("#AEB4BD");
    expect(c.team).toEqual(teamColor);
    expect(c.dice).toEqual({ face: "#FFFFFF", pip: "#17181C" });
    expect(c.pawnStroke).toBe("rgba(0,0,0,0.32)");
  });

  it("classic is the default theme, and is free", () => {
    expect(DEFAULT_THEME).toBe(BOARD_THEMES.classic);
    expect(BOARD_THEMES.classic.price).toBe(0);
  });

  it("every theme fully defines every surface", () => {
    for (const [key, t] of Object.entries(BOARD_THEMES)) {
      expect(t.id).toBe(key);
      expect(t.label.length).toBeGreaterThan(0);
      for (const v of [t.boardBase, t.boardEdge, t.cellFill, t.cellBorder, t.starColor, t.pawnStroke, t.dice.face, t.dice.pip]) {
        expect(v).toMatch(COLOR);
      }
      for (const color of ["red", "green", "yellow", "blue"] as const) {
        expect(t.team[color]).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });

  it("theme ids are the thirteen skins, uniquely keyed", () => {
    expect(Object.keys(BOARD_THEMES).sort()).toEqual([
      "aurora",
      "blossom",
      "celestial",
      "classic",
      "garden",
      "gilded",
      "moonlit",
      "nacre",
      "night",
      "onyx",
      "peacock",
      "sand",
      "walnut",
    ]);
  });

  it("leaves the themes that shipped before the premium tiers untouched", () => {
    // Anyone who already owns one of these bought the board they can see. A
    // premium treatment landing on it later is a restyle of something sold.
    for (const id of ORIGINAL) {
      const t: BoardTheme = BOARD_THEMES[id];
      expect(t.plate, id).toBeUndefined();
      expect(t.lip, id).toBeUndefined();
      expect(t.cellTop, id).toBeUndefined();
      expect(t.glyph, id).toBeUndefined();
      expect(t.sheen, id).toBeUndefined();
      expect(t.crest, id).toBeUndefined();
      expect(t.texture, id).toBeUndefined();
      expect(t.inlay, id).toBeUndefined();
      expect(t.band, id).toBeUndefined();
      expect(t.vignette, id).toBeUndefined();
    }
  });

  it("premium treatments are well-formed", () => {
    for (const t of Object.values(BOARD_THEMES)) {
      if (t.plate) {
        expect(t.plate.colors.length, t.id).toBeGreaterThanOrEqual(2);
        for (const c of t.plate.colors) expect(c, t.id).toMatch(COLOR);
        if (t.plate.positions) {
          expect(t.plate.positions, t.id).toHaveLength(t.plate.colors.length);
          // Ascending and inside [0,1]; Skia silently mis-paints otherwise.
          const p = t.plate.positions;
          expect(p[0], t.id).toBe(0);
          expect(p[p.length - 1], t.id).toBe(1);
          for (let i = 1; i < p.length; i++) expect(p[i]!, t.id).toBeGreaterThan(p[i - 1]!);
        }
      }
      if (t.lip) expect(t.lip, t.id).toMatch(COLOR);
      if (t.cellTop) expect(t.cellTop, t.id).toMatch(COLOR);
      if (t.sheen !== undefined) {
        expect(t.sheen, t.id).toBeGreaterThanOrEqual(0);
        expect(t.sheen, t.id).toBeLessThanOrEqual(0.2); // above this it is fog, not gloss
      }
      for (const layer of [t.texture, t.inlay]) {
        if (!layer) continue;
        expect(layer.color, t.id).toMatch(COLOR);
        expect(layer.alpha, t.id).toBeGreaterThan(0);
        expect(layer.alpha, t.id).toBeLessThanOrEqual(1);
      }
      if (t.band) {
        expect(t.band.color, t.id).toMatch(COLOR);
        if (t.band.yardColor) expect(t.band.yardColor, t.id).toMatch(COLOR);
        expect(t.band.alpha, t.id).toBeGreaterThan(0);
        expect(t.band.alpha, t.id).toBeLessThanOrEqual(1);
      }
      if (t.vignette !== undefined) {
        expect(t.vignette, t.id).toBeGreaterThan(0);
        expect(t.vignette, t.id).toBeLessThanOrEqual(0.5); // beyond this the corners go black
      }
      if (t.crest) {
        expect(t.crest.color, t.id).toMatch(COLOR);
        expect(t.crest.alpha, t.id).toBeGreaterThan(0);
        expect(t.crest.alpha, t.id).toBeLessThanOrEqual(1);
        // The centre square is three cells across; a wider medallion runs over
        // the finishing wedges' seams and into the track.
        expect(t.crest.scale, t.id).toBeLessThanOrEqual(1.5);
      }
    }
  });

  it("keeps every seat colour distinguishable on every board", () => {
    // A cosmetic may re-tone a seat but never blur two of them together: the
    // colour IS the player at the table. Compared in RGB, which is crude, but
    // it catches the failure that matters (two seats converging on one board).
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (const t of Object.values(BOARD_THEMES)) {
      const seats = Object.entries(t.team);
      for (let i = 0; i < seats.length; i++) {
        for (let j = i + 1; j < seats.length; j++) {
          const [a, b] = [rgb(seats[i]![1]), rgb(seats[j]![1])];
          const d = Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
          expect(d, `${t.id}: ${seats[i]![0]} vs ${seats[j]![0]}`).toBeGreaterThan(90);
        }
      }
    }
  });
});

describe("resolveBoardTheme", () => {
  it("resolves every known id to its own theme", () => {
    for (const t of Object.values(BOARD_THEMES)) expect(resolveBoardTheme(t.id)).toBe(t);
  });

  it("falls back to classic for anything it does not know", () => {
    // The equipped id is persisted locally, so a build that no longer knows it
    // (a staged rollback, a downgrade) must not read colors off undefined and
    // take the game screen down with it.
    for (const bogus of [null, undefined, "", "gilded-royal", "__proto__", "constructor", "toString"]) {
      expect(resolveBoardTheme(bogus)).toBe(BOARD_THEMES.classic);
    }
  });
});

// --- Catalog parity ----------------------------------------------------------
// Prices are display-only client-side (the catalog table is the authority), but
// a board priced 3,000 in the registry and 300 in the database is a shop that
// lies. Scanned across every migration, not one file: tiers arrive tier by tier
// (0013 the originals, 0018 aurora, 0061 the premium ladders), so reading a
// single file would let the newest one quietly escape the check.

const MIGRATIONS = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));

const sql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(MIGRATIONS + f, "utf8"))
  .join("\n");

/** Every seeded `theme.*` catalog row: id -> price + currency. The currency
 *  column arrived in 0018, so the older rows are 4-tuples and default to coins
 *  exactly as the column does. */
function themeSeeds(): Map<string, { price: number; currency: string }> {
  const out = new Map<string, { price: number; currency: string }>();
  const re = /\(\s*'theme\.([a-z0-9-]+)'\s*,\s*'theme'\s*,\s*(\d+)\s*,(?:\s*'(coins|gems)'\s*,)?\s*true\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) out.set(m[1]!, { price: Number(m[2]), currency: m[3] ?? "coins" });
  return out;
}

describe("board catalog seed parity (all migrations)", () => {
  const seeds = themeSeeds();

  it("seeds a row for every theme in the registry, at the registry's price", () => {
    for (const t of Object.values(BOARD_THEMES)) {
      const seed = seeds.get(t.id);
      expect(seed, t.id).toBeDefined();
      expect(seed!.price, t.id).toBe(t.price);
      expect(seed!.currency, t.id).toBe(t.currency ?? "coins");
    }
  });

  it("seeds no theme the client cannot render", () => {
    for (const id of seeds.keys()) expect(Object.keys(BOARD_THEMES), id).toContain(id);
  });
});
