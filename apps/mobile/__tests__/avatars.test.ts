/**
 * The avatar art is generated (scripts/avatar-art.mjs draws it, gen-avatars.mjs
 * rasterizes it) and shipped as PNGs, so these guard the catalog rather than the
 * rendering: the app's id list and the generator's must agree, every id must
 * have an image on disk, and the colors must stay legible against the chip and
 * distinct from the seat colors.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { AVATARS, CHIP_TONES, buildSVG, contrastRatio, hslOf, parseColor, renderAvatar, saturationOf, svgToOps } from "../scripts/gen-avatars.mjs";
import { AVATAR_IDS, AVATAR_NAMES, DEFAULT_AVATAR_ID, avatarName, resolveAvatarId } from "../src/render/avatars";
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

  // The shop used to label an avatar with its raw id. That is fine while every
  // id is a word ("leo") and wrong the moment one is not: "onyx-ii" title-cases
  // to "Onyx-Ii". Names live in the client registry, and must say exactly what
  // the art catalog says the character is called.
  it("gives every avatar the name its art catalog declares", () => {
    for (const spec of AVATARS) {
      expect(AVATAR_NAMES[spec.id as keyof typeof AVATAR_NAMES], `${spec.id} has no display name`).toBe(spec.name);
    }
    expect(Object.keys(AVATAR_NAMES).sort()).toEqual([...AVATAR_IDS].sort());
  });

  it("names any stored id, legacy slugs and unknowns included", () => {
    expect(avatarName("onyx-ii")).toBe("Onyx II");
    expect(avatarName("orbit-moss")).toBe("Leo");
    expect(avatarName(null)).toBe(AVATAR_NAMES[DEFAULT_AVATAR_ID]);
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
  //
  // This is also the rule avatar set v2's reference sheet broke, by putting the
  // rarity tier in the chip background: its "rare" was a pale blue at 215deg
  // and its "legendary" a gold at 46deg, against the yellow seat's 46deg.
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
    // apart by its face, hair and bust (asserted below), never by its chip.
    for (const spec of AVATARS) {
      expect(Object.keys(CHIP_TONES), `${spec.id} has an unknown tone`).toContain(spec.tone);
    }
  });

  // PlayerChip frames the avatar in the seat's colour and learned that a second
  // coloured frame under that one reads as a double border, so the chip's own
  // edge is a neutral hairline. The reference sheet drew a 10-unit tier ring
  // here; this is the assertion that keeps it out.
  it("draws no coloured ring inside the chip edge", () => {
    // Only the chip's own edge — a stroke that traces a circle on the chip's
    // centre at most of its radius. Earrings, a helmet rim and Selene's moon
    // are circular strokes too, and they are allowed to have a colour.
    const isChipEdge = (op: any) => {
      if (!op.stroke || op.polys.length !== 1) return false;
      const xs = op.polys[0].pts.map((p: number[]) => p[0]);
      const ys = op.polys[0].pts.map((p: number[]) => p[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const r = (Math.max(...xs) - Math.min(...xs)) / 2;
      return Math.abs(cx - 256) < 2 && Math.abs(cy - 256) < 2 && r > 200;
    };
    for (const spec of AVATARS) {
      const edges = svgToOps(buildSVG(spec)).filter(isChipEdge);
      expect(edges.length, `${spec.id} has no chip edge`).toBe(1);
      const stroke = edges[0].stroke as string;
      const neutral = !stroke.startsWith("#") || hslOf(stroke).s < 0.06;
      expect(neutral, `${spec.id} draws a coloured ring (${stroke}) inside the chip edge`).toBe(true);
    }
  });
});

describe("avatar silhouette", () => {
  // Every spec declares the colour of its outermost shape where that shape
  // meets the chip. v1's test read `hair` instead, which was the wrong field
  // for anyone in a hat: saga declared a dark blonde the chip never sees,
  // because a steel helm sits on top of it, and passed while rendering as a
  // pale shape on a pale chip. Measuring the edge is measuring what you see.
  it("declares an edge colour for every character", () => {
    for (const a of AVATARS) {
      expect(a.edge, `${a.id} declares no edge colour`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  // The head is drawn without an outline, so a silhouette no darker than the
  // chip renders as nothing at all. A character clears the chip either on its
  // own colour or on the rim it carries.
  it("keeps every silhouette readable against its chip", () => {
    for (const a of AVATARS) {
      const edge = a.rim ?? a.edge;
      expect(contrastRatio(edge, CHIP_TONES[a.tone]), `${a.id} vanishes into the ${a.tone} chip`).toBeGreaterThan(2);
    }
  });

  // A rim is an escape hatch, so guard it: it must be a real colour, it must be
  // darker than the edge it is rescuing (an outline that lightens a pale shape
  // is not an outline), and it must only exist where the edge actually fails.
  // Otherwise "add a rim" becomes the way to dodge the rule above.
  it("only rims a silhouette the chip cannot tell on its own", () => {
    for (const a of AVATARS) {
      if (a.rim === undefined) continue;
      expect(a.rim, `${a.id}'s rim is not a hex color`).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(
        contrastRatio(a.edge, CHIP_TONES[a.tone]),
        `${a.id} carries a rim it does not need — its edge already clears the chip`,
      ).toBeLessThan(2);
      expect(hslOf(a.rim).l, `${a.id}'s rim is lighter than the edge it outlines`).toBeLessThan(hslOf(a.edge).l);
    }
  });
});

describe("avatar identity", () => {
  it("gives every avatar a hex bust color", () => {
    for (const a of AVATARS) {
      expect(a.bust, `${a.id} has no bust color`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  // v1 keyed this on style/hair/shirt, which was the whole of a v1 character.
  // v2 varies the head as well, so the signature has to include it — otherwise
  // two characters could share a face shape, eye kit, brow and mouth and still
  // count as distinct because their hair differed by one hex digit.
  it("never repeats a visual signature", () => {
    const seen = new Map<string, string>();
    for (const a of AVATARS) {
      const key = [
        // A character preserved from v1 brings its own body, so the feature
        // fields say nothing about it — its art is the signature.
        a.legacy ?? "-",
        a.face ?? "round", a.eyes ?? "round", a.brow ?? "soft", a.mouth ?? "smile",
        a.hair ?? "-", a.hat ?? "-",
        (a.hairColor ?? a.hatColor ?? "-").toLowerCase(), a.bust.toLowerCase(), a.skin.toLowerCase(),
      ].join("|");
      const clash = seen.get(key);
      expect(clash, `${a.id} is indistinguishable from ${clash}`).toBeUndefined();
      seen.set(key, a.id);
    }
  });

  // A hat override escapes the bust rule below, so guard the escape hatch: it
  // has to be a real color, it has to be on an avatar that actually wears a
  // hat, and it must clear the chip. Onyx's red is the loudest of them,
  // restored because players recognised him by it.
  it("keeps any hat colour deliberate and legible", () => {
    for (const a of AVATARS) {
      if (a.hatColor === undefined) continue;
      expect(a.hatColor, `${a.id}'s hat is not a hex color`).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(a.hat, `${a.id} names a hat colour but wears no hat`).toBeTruthy();
      expect(contrastRatio(a.rim ?? a.hatColor, CHIP_TONES[a.tone]), `${a.id}'s hat vanishes into the chip`).toBeGreaterThan(2);
    }
  });

  it("keeps every bust muted below the least saturated team color", () => {
    const floor = Math.min(...Object.values(teamColor).map(saturationOf));
    for (const a of AVATARS) {
      expect(saturationOf(a.bust), `${a.id}'s bust competes with the seat color`).toBeLessThan(floor);
    }
  });
});

describe("avatar rendering", () => {
  // The SVG parser is deliberately strict — it throws on an element, attribute
  // or path command it does not implement, rather than drawing nothing. That is
  // only a safety net if something exercises every character through it, since
  // a face silently missing its crown is exactly the failure a generated-art
  // pipeline cannot see.
  it("draws every character without hitting an unsupported feature", () => {
    for (const spec of AVATARS) {
      expect(() => svgToOps(buildSVG(spec)), `${spec.id} uses an SVG feature the rasterizer lacks`).not.toThrow();
    }
  });

  // The regression this pins. Mirrored ornament — a laurel wreath, a winged
  // helm, a crown — used to come out lopsided, because the metal ramp behind it
  // ran on a diagonal axis and both ends clamped. v2's metals are flat, but the
  // asymmetry is worth pinning anyway: a crown that is one pixel wider on the
  // right is the kind of thing nothing but a render can prove.
  //
  // Only the crown of the chip is compared, and only for characters whose
  // crown is mirrored ornament and nothing else. Excluded on purpose: Selene,
  // because a crescent moon beside a star is asymmetric by design, and
  // everyone wearing `longStraight` hair (Astra, Mira, Ember, Rani, Frost),
  // because that hair carries a one-sided specular highlight — a light source
  // has a direction, and the same exemption the eye shine gets.
  const SIZE = 96;
  const CROWN_ROWS = Math.floor(SIZE * 0.28);

  for (const spec of AVATARS.filter((a) => ["laurel", "pharo", "regis", "solis"].includes(a.id))) {
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
