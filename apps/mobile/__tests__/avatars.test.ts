/**
 * The avatar art is generated (scripts/gen-avatars.mjs) and shipped as PNGs, so
 * these guard the catalog rather than the rendering: the app's id list and the
 * generator's must agree, every id must have an image on disk, and the colors
 * must stay legible against the chip and distinct from the seat colors.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { AVATARS, CHIP_TONES, contrastRatio, hslOf, parseColor, renderAvatar, saturationOf } from "../scripts/gen-avatars.mjs";
import { AVATAR_IDS, DEFAULT_AVATAR_ID, resolveAvatarId } from "../src/render/avatars";
import { teamColor } from "../src/theme";

const AVATAR_DIR = join(__dirname, "..", "assets", "images", "avatars");
const MIGRATIONS = join(__dirname, "..", "..", "..", "supabase", "migrations");

/** Every `avatar.<id>` SKU seeded anywhere in the migrations. */
function seededAvatarSkus(): Set<string> {
  const sql = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .join("\n");
  return new Set([...sql.matchAll(/'avatar\.([a-z0-9-]+)'/g)].map((m) => m[1]!));
}

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

  // An avatar with no catalog row is a tile the shop can never sell, and a
  // catalog row with no avatar is a purchase that resolves to no face. Dice
  // have been guarded both ways since 0014; faces were not, which is how the
  // coin tier could have shipped priced client-side and unsellable server-side.
  it("has a catalog row for every avatar, and an avatar for every row", () => {
    const seeded = seededAvatarSkus();
    for (const id of AVATAR_IDS) {
      expect(seeded.has(id), `${id} has no catalog row — it can never be sold`).toBe(true);
    }
    for (const sku of seeded) {
      expect(AVATAR_IDS, `avatar.${sku} is seeded but no such avatar exists`).toContain(sku);
    }
  });

  it("resolves legacy and unknown ids to a real avatar", () => {
    expect(AVATAR_IDS).toContain(DEFAULT_AVATAR_ID);
    expect(resolveAvatarId("orbit-moss")).toBe("leo");
    expect(resolveAvatarId("who-is-this")).toBe(DEFAULT_AVATAR_ID);
    expect(resolveAvatarId(null)).toBe(DEFAULT_AVATAR_ID);
  });
});

describe("avatar chip background", () => {
  const tones = () => Object.entries(CHIP_TONES) as [string, string][];

  // The chip is a flat fill and nothing else — no gradient, no motif behind the
  // character. A patterned chip reads as texture at 48pt on a player card and
  // competes with the board mid-turn, which is what got the patterns removed.
  it("is one plain color per tone", () => {
    for (const [name, tone] of tones()) {
      expect(tone, `chip ${name} is not a plain hex fill`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  // The load-bearing rule. Hue distance alone is not enough: it collapses under
  // colorblindness (deuteranopia merges red and green; violet drifts toward
  // blue). A chip that is always paler and flatter than any seat reads as
  // tinted paper next to the frame's vivid ring, whatever your color vision.
  it("stays paler and flatter than every seat color", () => {
    const seats = Object.entries(teamColor).map(([n, hex]) => [n, hslOf(hex)] as const);
    for (const [name, tone] of tones()) {
      const c = hslOf(tone);
      expect(c.s, `chip ${name} (${tone}) is too saturated`).toBeLessThanOrEqual(0.35);
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
    for (const [name, tone] of tones()) {
      const c = hslOf(tone);
      if (c.s < 0.06) {
        const [r, g, b] = parseColor(tone);
        expect(r === g && g === b, `chip ${name} (${tone}) is nearly grey but not exactly`).toBe(true);
        continue;
      }
      expect(c.h, `chip ${name} (${tone}) is outside the violet band`).toBeGreaterThanOrEqual(VIOLET_BAND[0]);
      expect(c.h, `chip ${name} (${tone}) is outside the violet band`).toBeLessThanOrEqual(VIOLET_BAND[1]);
    }
  });

  it("keeps every tone well clear of each seat hue", () => {
    const seatHues = Object.entries(teamColor).map(([n, hex]) => [n, hslOf(hex).h] as const);
    const apart = (a: number, b: number) => {
      const d = Math.abs(a - b) % 360;
      return d > 180 ? 360 - d : d;
    };
    for (const [name, tone] of tones()) {
      const c = hslOf(tone);
      if (c.s < 0.06) continue; // a true grey has no hue to compare
      for (const [seat, h] of seatHues) {
        expect(apart(c.h, h), `chip ${name} (${tone}) sits too near the ${seat} seat hue`).toBeGreaterThanOrEqual(40);
      }
    }
  });

  it("gives every character a known tone", () => {
    // Tones repeat on purpose — the chip is a backdrop, and a character is told
    // apart by its face, hair and shirt (asserted below), never by its chip.
    for (const spec of AVATARS) {
      expect(Object.keys(CHIP_TONES), `${spec.id} has an unknown tone`).toContain(spec.tone);
    }
  });
});

describe("premium regalia", () => {
  // The regression this pins. The metal ramps started life on a diagonal axis,
  // which put t<0 at the left edge of a wreath and t>1 at the right — both
  // clamp, so saga rendered one wing white and the other charcoal, and every
  // mirrored ornament in the tier was lopsided. A vertical ramp is the only
  // one that survives mirroring, and nothing but a render can prove it did.
  //
  // Only the crown of the chip is compared. Below it sit highlights that are
  // off-centre on purpose — the eye shine, and the specular on regis's
  // amethyst — and selene is exempt outright because a crescent moon beside a
  // star is asymmetric by design.
  const SIZE = 96;
  const CROWN_ROWS = Math.floor(SIZE * 0.33); // design y < ~33: ornament only

  for (const spec of AVATARS.filter((a) => ["laurel", "saga", "pharo", "regis", "astra", "solis"].includes(a.id))) {
    it(`draws ${spec.id}'s ornament the same on both sides`, () => {
      const px = renderAvatar(spec, SIZE);
      let worst = 0;
      for (let y = 0; y < CROWN_ROWS; y++) {
        for (let x = 0; x < SIZE / 2; x++) {
          const a = (y * SIZE + x) * 4;
          const b = (y * SIZE + (SIZE - 1 - x)) * 4;
          for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(px[a + c]! - px[b + c]!));
        }
      }
      expect(worst, `${spec.id} is lopsided across the centre line`).toBeLessThanOrEqual(2);
    });
  }
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
      const key = `${a.style}|${a.hair.toLowerCase()}|${a.shirt.toLowerCase()}|${(a.cap ?? a.shirt).toLowerCase()}`;
      const clash = seen.get(key);
      expect(clash, `${a.id} is indistinguishable from ${clash}`).toBeUndefined();
      seen.set(key, a.id);
    }
  });

  it("keeps every hair color readable against the neutral chip", () => {
    // The head has a dark outline, so skin needs no contrast against the chip;
    // hair is drawn bare, so a pale hair color on a pale chip renders bald.
    for (const a of AVATARS) {
      expect(contrastRatio(a.hair, CHIP_TONES[a.tone]), `${a.id}'s hair vanishes into the chip`).toBeGreaterThan(2);
    }
  });

  // A cap override escapes the shirt rule below, so guard the escape hatch: it
  // has to be a real color, it has to be on an avatar that actually wears a cap,
  // and it must not turn a character into a seat color's twin. Onyx's red is the
  // one override, restored because players recognised him by it.
  it("keeps any cap override deliberate and legible", () => {
    for (const a of AVATARS) {
      if (a.cap === undefined) continue;
      expect(a.cap, `${a.id}'s cap is not a hex color`).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(a.style, `${a.id} names a cap color but wears no cap`).toBe("cap");
      expect(contrastRatio(a.cap, CHIP_TONES[a.tone]), `${a.id}'s cap vanishes into the chip`).toBeGreaterThan(2);
    }
  });

  it("keeps every shirt muted below the least saturated team color", () => {
    const floor = Math.min(...Object.values(teamColor).map(saturationOf));
    for (const a of AVATARS) {
      expect(saturationOf(a.shirt), `${a.id}'s shirt competes with the seat color`).toBeLessThan(floor);
    }
  });
});
