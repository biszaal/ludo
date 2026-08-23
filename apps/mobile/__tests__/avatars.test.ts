/**
 * The avatar art is generated (scripts/gen-avatars.mjs) and shipped as PNGs, so
 * these guard the catalog rather than the rendering: the app's id list and the
 * generator's must agree, every id must have an image on disk, and the colors
 * must stay legible against the chip and distinct from the seat colors.
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { AVATARS, AVATAR_CHIP, contrastRatio, saturationOf } from "../scripts/gen-avatars.mjs";
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
  it("is one shared neutral, never a per-character color", () => {
    expect(AVATAR_CHIP.top).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(AVATAR_CHIP.bottom).toMatch(/^#[0-9A-Fa-f]{6}$/);
    for (const a of AVATARS) {
      expect(a, `${a.id} still carries its own chip background`).not.toHaveProperty("bgTop");
      expect(a, `${a.id} still carries its own chip background`).not.toHaveProperty("bgBottom");
    }
  });

  it("is neutral enough to sit inside any team-colored frame", () => {
    expect(saturationOf(AVATAR_CHIP.top)).toBeLessThan(0.45);
    expect(saturationOf(AVATAR_CHIP.bottom)).toBeLessThan(0.45);
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
      expect(contrastRatio(a.hair, AVATAR_CHIP.top), `${a.id}'s hair vanishes into the chip`).toBeGreaterThan(2);
    }
  });

  it("keeps every shirt muted below the least saturated team color", () => {
    const floor = Math.min(...Object.values(teamColor).map(saturationOf));
    for (const a of AVATARS) {
      expect(saturationOf(a.shirt), `${a.id}'s shirt competes with the seat color`).toBeLessThan(floor);
    }
  });
});
