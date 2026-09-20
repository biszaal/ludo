/**
 * Avatar catalog — the ids the app knows, and nothing about how they look.
 *
 * The art lives in scripts/avatar-art.mjs, which draws each character, and
 * scripts/gen-avatars.mjs, which writes assets/images/avatars/<id>.png;
 * render/avatarImages.ts maps an id to its image. Splitting it that way keeps
 * this module dependency-free (like
 * boardThemes.ts and diceSkins.ts) so the cosmetics catalog and the Node unit
 * tests can read the id set without pulling in a binary asset.
 *
 * Avatar ids are stable slugs stored in the profile (and the Supabase profiles
 * table); LEGACY_IDS keeps profiles saved under the old geometric-motif ids
 * pointing at a stable face.
 */

export const AVATAR_IDS = [
  "leo",
  "sunny",
  "coco",
  "zara",
  "rex",
  "nina",
  "milo",
  "ivy",
  "ace",
  "ruby",
  "bruno",
  "kito",
  // The gem tier (0018 seed).
  "nova",
  "onyx",
  // Regalia — the coin prestige tier (0059 seed).
  "laurel",
  "saga",
  "pharo",
  "regis",
  // Celestial — the gem prestige tier (0059 seed).
  "astra",
  "selene",
  "solis",
  // Avatar set v2 (0070 seed). Twelve faces the set had nothing like: a South
  // Asian line, which is the audience this game actually has, and characters
  // who are not human at all.
  "momo",
  "tashi",
  "bolt",
  "rana",
  "mira",
  "sylva",
  "draco",
  "vega",
  "frost",
  "diya",
  "ember",
  "rani",
  // Onyx II — the v2 drawing of Onyx, sold beside the original rather than
  // replacing it (0071 seed). See scripts/avatar-art.mjs for why.
  "onyx-ii",
] as const;

export type AvatarId = (typeof AVATAR_IDS)[number];

export const DEFAULT_AVATAR_ID: AvatarId = "leo";

/** Profiles saved before the cartoon set map to a stable face, not the default. */
const LEGACY_IDS: Record<string, AvatarId> = {
  "orbit-moss": "leo",
  "peak-dusk": "sunny",
  "quad-clay": "coco",
  "wave-teal": "zara",
  "ring-plum": "rex",
  "spark-sand": "nina",
  "orbit-plum": "milo",
  "peak-moss": "ivy",
  "quad-teal": "ace",
  "wave-dusk": "ruby",
  "ring-sand": "bruno",
  "spark-clay": "kito",
};

const KNOWN = new Set<string>(AVATAR_IDS);

/** Normalizes any stored id (legacy slug, unknown, null) to a real avatar. */
export function resolveAvatarId(id: string | null | undefined): AvatarId {
  if (!id) return DEFAULT_AVATAR_ID;
  const mapped = LEGACY_IDS[id] ?? id;
  return KNOWN.has(mapped) ? (mapped as AvatarId) : DEFAULT_AVATAR_ID;
}
