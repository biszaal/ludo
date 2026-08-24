/**
 * The avatar art is generated (scripts/gen-avatars.mjs) and shipped as PNGs, so
 * these guard the catalog rather than the rendering: the app's id list and the
 * generator's must agree, every id must have an image on disk, and the colors
 * must stay legible against the chip and distinct from the seat colors.
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { AVATARS, CHIP_TONES, PATTERNS, chipOps, contrastRatio, hslOf, parseColor, saturationOf } from "../scripts/gen-avatars.mjs";
import { AVATAR_IDS, DEFAULT_AVATAR_ID, resolveAvatarId } from "../src/render/avatars";
import { teamColor } from "../src/theme";

const AVATAR_DIR = join(__dirname, "..", "assets", "images", "avatars");

describe("avatar catalog", () => {
  it("ships an image for every id the app knows", () => {
    expect(AVATAR_IDS.length).toBeGreaterThan(0);
    for (const id of AVATAR_IDS) {
      expect(existsSync(join(AVATAR_DIR, `${id}.png`)), `missing ${id}.png — run scripts/gen-avatars.mjs`).toBe(true);
    }
  });

  it("keeps the app's id list in step with the generator's", () => {
    // The two lists live in different files now; drift would ship an avatar
    // nobody can select, or a tile pointing at an image that was never drawn.
    expect([...AVATAR_IDS].sort()).toEqual(AVATARS.map((a) => a.id).sort());
  });

  it("resolves legacy and unknown ids to a real avatar", () => {
    expect(AVATAR_IDS).toContain(DEFAULT_AVATAR_ID);
    expect(resolveAvatarId("orbit-moss")).toBe("leo");
    expect(resolveAvatarId("who-is-this")).toBe(DEFAULT_AVATAR_ID);
    expect(resolveAvatarId(null)).toBe(DEFAULT_AVATAR_ID);
  });
});

describe("avatar chip background", () => {
  const toneStops = () =>
    Object.entries(CHIP_TONES).flatMap(([name, t]) => [
      [`${name}.top`, t.top] as const,
      [`${name}.bottom`, t.bottom] as const,
    ]);

  // The load-bearing rule. Hue distance alone is not enough: it collapses under
  // colorblindness (deuteranopia merges red and green; violet drifts toward
  // blue). A chip that is always paler and flatter than any seat reads as
  // tinted paper next to the frame's vivid ring, whatever your color vision.
  it("stays paler and flatter than every seat color", () => {
    const seats = Object.entries(teamColor).map(([n, hex]) => [n, hslOf(hex)] as const);
    for (const [name, stop] of toneStops()) {
      const c = hslOf(stop);
      expect(c.s, `chip ${name} (${stop}) is too saturated`).toBeLessThanOrEqual(0.35);
      for (const [seat, sc] of seats) {
        expect(c.s, `chip ${name} is as saturated as the ${seat} seat`).toBeLessThan(sc.s);
        expect(c.l - sc.l, `chip ${name} is not clearly lighter than the ${seat} seat`).toBeGreaterThan(0.1);
      }
    }
  });

  // The seats own red, green, yellow and blue, so the chips use none of those
  // families at all: a tone is either a true grey or sits in the violet/magenta
  // band, which is the widest gap the seat hues leave (blue->red, 132deg).
  it("uses no seat colour family — only true greys and violets", () => {
    const VIOLET_BAND = [270, 330] as const;
    for (const [name, stop] of toneStops()) {
      const c = hslOf(stop);
      if (c.s < 0.06) {
        const [r, g, b] = parseColor(stop);
        expect(r === g && g === b, `chip ${name} (${stop}) is nearly grey but not exactly`).toBe(true);
        continue;
      }
      expect(c.h, `chip ${name} (${stop}) is outside the violet band`).toBeGreaterThanOrEqual(VIOLET_BAND[0]);
      expect(c.h, `chip ${name} (${stop}) is outside the violet band`).toBeLessThanOrEqual(VIOLET_BAND[1]);
    }
  });

  it("keeps every tone well clear of each seat hue", () => {
    const seatHues = Object.entries(teamColor).map(([n, hex]) => [n, hslOf(hex).h] as const);
    const apart = (a: number, b: number) => {
      const d = Math.abs(a - b) % 360;
      return d > 180 ? 360 - d : d;
    };
    for (const [name, stop] of toneStops()) {
      const c = hslOf(stop);
      if (c.s < 0.06) continue; // a true grey has no hue to compare
      for (const [seat, h] of seatHues) {
        expect(apart(c.h, h), `chip ${name} (${stop}) sits too near the ${seat} seat hue`).toBeGreaterThanOrEqual(40);
      }
    }
  });

  it("draws its pattern in pure black or white alpha, never a hue", () => {
    // Patterns modulate tone only. Anything with a hue here could drift toward
    // a seat color as the art changes.
    for (const spec of AVATARS) {
      for (const op of chipOps(spec)) {
        const color = op.fill ?? op.color;
        expect(color, `${spec.id}'s ${spec.pattern} pattern has a colorless op`).toBeDefined();
        const [r, g, b] = parseColor(color!);
        expect(r === g && g === b, `${spec.id}'s ${spec.pattern} pattern uses a hue: ${color}`).toBe(true);
      }
    }
  });

  it("gives every character a distinct tone and pattern pairing", () => {
    const seen = new Map<string, string>();
    for (const spec of AVATARS) {
      expect(PATTERNS, `${spec.id} has an unknown pattern`).toContain(spec.pattern);
      expect(Object.keys(CHIP_TONES), `${spec.id} has an unknown tone`).toContain(spec.tone);
      const key = `${spec.tone}|${spec.pattern}`;
      const clash = seen.get(key);
      expect(clash, `${spec.id} has the same chip as ${clash}`).toBeUndefined();
      seen.set(key, spec.id);
    }
  });
});

describe("avatar identity without a colored background", () => {
  it("gives every avatar a hex shirt color", () => {
    for (const a of AVATARS) {
      expect(a.shirt, `${a.id} has no shirt color`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("never repeats a style/hair/shirt combination", () => {
    const seen = new Map<string, string>();
    for (const a of AVATARS) {
      const key = `${a.style}|${a.hair.toLowerCase()}|${a.shirt.toLowerCase()}`;
      const clash = seen.get(key);
      expect(clash, `${a.id} is indistinguishable from ${clash}`).toBeUndefined();
      seen.set(key, a.id);
    }
  });

  it("keeps every hair color readable against the neutral chip", () => {
    // The head has a dark outline, so skin needs no contrast against the chip;
    // hair is drawn bare, so a pale hair color on a pale chip renders bald.
    for (const a of AVATARS) {
      expect(contrastRatio(a.hair, CHIP_TONES[a.tone].top), `${a.id}'s hair vanishes into the chip`).toBeGreaterThan(2);
    }
  });

  it("keeps every shirt muted below the least saturated team color", () => {
    const floor = Math.min(...Object.values(teamColor).map(saturationOf));
    for (const a of AVATARS) {
      expect(saturationOf(a.shirt), `${a.id}'s shirt competes with the seat color`).toBeLessThan(floor);
    }
  });
});
