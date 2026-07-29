/**
 * The dice-skin catalog. Guards three things: the shop only ever shows skins
 * the server actually sells (seed parity with 0014_dice_skins.sql), unknown
 * or missing skins always fall back to "classic" instead of crashing a
 * render, and every skin sticks to purely cosmetic fields (a stray gameplay
 * property here would be a design smell, not a schema change — see the
 * catalog migration's own comment to that effect).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BOARD_THEMES } from "../src/render/boardThemes";
import { DEFAULT_DICE_SKIN, DICE_SKINS, diceRenderParams, resolveDiceSkin } from "../src/render/diceSkins";

const HEX = /^#[0-9A-Fa-f]{6}$/;
const ALLOWED_KEYS = ["id", "label", "price", "currency", "face", "pip", "edge", "frame", "overlay"];

/** Independent of the implementation's own hexRGB — just parses a literal. */
function rgbOf(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

describe("dice skin registry", () => {
  it("has 14 unique ids matching the sku id format", () => {
    const ids = Object.values(DICE_SKINS).map((s) => s.id);
    expect(ids.length).toBe(14);
    expect(new Set(ids).size).toBe(14);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]{1,24}$/);
  });

  it("keys every entry under its own id", () => {
    for (const [key, skin] of Object.entries(DICE_SKINS)) expect(skin.id).toBe(key);
  });

  it("declares coin skins in ascending price order (cheap to prestige)", () => {
    // Gem-tier skins sit after the coin ladder on their own price scale.
    const prices = Object.values(DICE_SKINS)
      .filter((s) => s.currency !== "gems")
      .map((s) => s.price);
    const sorted = [...prices].sort((a, b) => a - b);
    expect(prices).toEqual(sorted);
  });

  it("makes classic free and the default, inheriting the board theme's dice", () => {
    const c = DICE_SKINS.classic;
    expect(c.price).toBe(0);
    expect(c.face).toBeNull();
    expect(c.pip).toBeNull();
    expect(DEFAULT_DICE_SKIN).toBe(c);
  });

  it("sticks to cosmetic-only fields (no gameplay-shaped property could hide here)", () => {
    for (const skin of Object.values(DICE_SKINS)) {
      for (const key of Object.keys(skin)) expect(ALLOWED_KEYS).toContain(key);
    }
  });

  it("uses valid, legible colors everywhere a skin defines its own", () => {
    for (const skin of Object.values(DICE_SKINS)) {
      if (skin.face?.type === "solid") expect(skin.face.color).toMatch(HEX);
      if (skin.face?.type === "linear") {
        expect(skin.face.colors.length).toBeGreaterThanOrEqual(2);
        for (const c of skin.face.colors) expect(c).toMatch(HEX);
        if (skin.face.stops) {
          expect(skin.face.stops.length).toBe(skin.face.colors.length);
          for (let i = 1; i < skin.face.stops.length; i++) {
            expect(skin.face.stops[i]!).toBeGreaterThan(skin.face.stops[i - 1]!);
          }
          expect(skin.face.stops[0]!).toBeGreaterThanOrEqual(0);
          expect(skin.face.stops[skin.face.stops.length - 1]!).toBeLessThanOrEqual(1);
        }
      }
      if (skin.pip) {
        expect(skin.pip.color).toMatch(HEX);
        if (skin.pip.glow) expect(skin.pip.glow).toMatch(HEX);
      }
      if (skin.edge) expect(skin.edge).toMatch(HEX);
      if (skin.frame) expect(skin.frame).toMatch(HEX);
      expect(skin.label.length).toBeGreaterThan(0);
    }
  });

  it("gives every non-classic skin its own face/pip treatment (no accidental duplicates)", () => {
    const nonClassic = Object.values(DICE_SKINS).filter((s) => s.id !== "classic");
    const signatures = new Set(nonClassic.map((s) => JSON.stringify([s.face, s.pip])));
    expect(signatures.size).toBe(nonClassic.length);
  });
});

describe("resolveDiceSkin", () => {
  it("falls back to classic for null, undefined, or an unknown id", () => {
    expect(resolveDiceSkin(null)).toBe(DEFAULT_DICE_SKIN);
    expect(resolveDiceSkin(undefined)).toBe(DEFAULT_DICE_SKIN);
    expect(resolveDiceSkin("hax-9000")).toBe(DEFAULT_DICE_SKIN);
    // A bracket-indexed lookup table would resolve this to Object.prototype;
    // resolveDiceSkin must never do a raw `DICE_SKINS[id]` lookup.
    expect(resolveDiceSkin("__proto__")).toBe(DEFAULT_DICE_SKIN);
    expect(resolveDiceSkin("constructor")).toBe(DEFAULT_DICE_SKIN);
  });

  it("resolves a known id to its exact spec", () => {
    expect(resolveDiceSkin("gold")).toBe(DICE_SKINS.gold);
  });
});

describe("diceRenderParams", () => {
  it("inherits the board theme's dice colors for classic", () => {
    const p = diceRenderParams(DICE_SKINS.classic, BOARD_THEMES.night);
    expect(p.faceRGB).toEqual(rgbOf(BOARD_THEMES.night.dice.face));
    expect(p.pipRGB).toEqual(rgbOf(BOARD_THEMES.night.dice.pip));
    expect(p.gradient).toBeNull();
    expect(p.pipShape).toBe("dot");
  });

  it("falls back to the original white/ink literals with no skin and no theme", () => {
    const p = diceRenderParams(undefined, undefined);
    expect(p.faceRGB).toEqual([255, 255, 255]);
    expect(p.pipRGB).toEqual(rgbOf("#17181C"));
    expect(p.gradient).toBeNull();
    expect(p.pipShape).toBe("dot");
    expect(p.glow).toBeNull();
    expect(p.overlay).toBeNull();
    expect(p.frame).toBeNull();
    expect(p.edgeRGB).toBeNull();
  });

  it("takes its primary color from the first gradient stop", () => {
    const goldFace = DICE_SKINS.gold.face;
    if (goldFace?.type !== "linear") throw new Error("expected gold to be a gradient skin");
    const p = diceRenderParams(DICE_SKINS.gold, BOARD_THEMES.classic);
    expect(p.faceRGB).toEqual(rgbOf(goldFace.colors[0]!));
    expect(p.gradient?.colors).toEqual(goldFace.colors);
  });

  it("carries a skin's shaped pip, glow, overlay and frame through untouched", () => {
    const king = DICE_SKINS["obsidian-king"];
    const p = diceRenderParams(king, BOARD_THEMES.classic);
    expect(p.pipShape).toBe("crown");
    expect(p.glow).toBe(king.pip!.glow);
    expect(p.frame).toBe(king.frame);
    expect(p.overlay).toBe(king.overlay);
    expect(p.edgeRGB).toEqual(rgbOf(king.edge!));
  });

  it("gives every skin a stable overlay seed, independent of the viewer's board theme", () => {
    const a = diceRenderParams(DICE_SKINS.galaxy, BOARD_THEMES.classic);
    const b = diceRenderParams(DICE_SKINS.galaxy, BOARD_THEMES.night);
    expect(a.overlaySeed).toBe(b.overlaySeed);
    expect(Number.isFinite(a.overlaySeed)).toBe(true);
    const c = diceRenderParams(DICE_SKINS.diamond, BOARD_THEMES.classic);
    expect(c.overlaySeed).not.toBe(a.overlaySeed);
  });
});

describe("seed parity with the server catalog", () => {
  it("matches the 0014 + 0018 migration seeds exactly (same ids, same prices)", () => {
    const seeded = new Map<string, number>();

    // 0014: coin-priced rows — (sku, 'dice', price, true).
    const coinSql = readFileSync(
      fileURLToPath(new URL("../../../supabase/migrations/0014_dice_skins.sql", import.meta.url)),
      "utf8",
    );
    const coinRe = /\(\s*'dice\.([a-z0-9-]+)'\s*,\s*'dice'\s*,\s*(\d+)\s*,\s*true\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = coinRe.exec(coinSql))) seeded.set(m[1]!, Number(m[2]));

    // 0018: gem-priced rows — (sku, 'dice', price, 'gems', true).
    const gemSql = readFileSync(
      fileURLToPath(new URL("../../../supabase/migrations/0018_gems.sql", import.meta.url)),
      "utf8",
    );
    const gemRe = /\(\s*'dice\.([a-z0-9-]+)'\s*,\s*'dice'\s*,\s*(\d+)\s*,\s*'gems'\s*,\s*true\s*\)/g;
    while ((m = gemRe.exec(gemSql))) seeded.set(m[1]!, Number(m[2]));

    const registryIds = new Set(Object.values(DICE_SKINS).map((s) => s.id));
    expect(seeded.size).toBeGreaterThan(0);
    expect(new Set(seeded.keys())).toEqual(registryIds);
    for (const skin of Object.values(DICE_SKINS)) {
      expect(seeded.get(skin.id)).toBe(skin.price);
    }
  });
});
