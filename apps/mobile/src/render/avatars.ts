/**
 * Avatar catalog — the pure data (ids, chip palette, hair/style) behind the
 * Skia-drawn chips in components/Avatar.tsx. Kept dependency-free (like
 * boardThemes.ts and diceSkins.ts) so the unified cosmetics catalog and its
 * Node unit tests can read the avatar id set without importing Skia.
 *
 * Avatar ids are stable slugs stored in the profile (and the Supabase profiles
 * table); LEGACY_IDS keeps profiles saved under the old geometric-motif ids
 * pointing at a stable face.
 */

export type AvatarStyle =
  | "crown"
  | "spiky"
  | "afro"
  | "bun"
  | "cap"
  | "pigtails"
  | "side"
  | "beanie"
  | "headphones"
  | "bow"
  | "beard"
  | "cat";

export interface AvatarSpec {
  id: string;
  /** Chip gradient, top → bottom. */
  bgTop: string;
  bgBottom: string;
  skin: string;
  hair: string;
  style: AvatarStyle;
}

export const AVATARS: AvatarSpec[] = [
  { id: "leo", bgTop: "#FFD75E", bgBottom: "#F5A100", skin: "#FFD9B3", hair: "#7A4A21", style: "crown" },
  { id: "sunny", bgTop: "#FF9D66", bgBottom: "#F0642F", skin: "#FFE0C2", hair: "#E8542F", style: "spiky" },
  { id: "coco", bgTop: "#7ED09A", bgBottom: "#2FA968", skin: "#8A5A3B", hair: "#26150B", style: "afro" },
  { id: "zara", bgTop: "#FF8FB1", bgBottom: "#E24E7B", skin: "#C68642", hair: "#2B1B10", style: "bun" },
  { id: "rex", bgTop: "#7FB2FF", bgBottom: "#3E63DD", skin: "#FFD9B3", hair: "#5A3A1E", style: "cap" },
  { id: "nina", bgTop: "#C79BFF", bgBottom: "#8A4FD0", skin: "#8A5A3B", hair: "#1E1208", style: "pigtails" },
  { id: "milo", bgTop: "#8EE0DC", bgBottom: "#2E9E96", skin: "#FFE0C2", hair: "#B0722F", style: "side" },
  { id: "ivy", bgTop: "#B4E07C", bgBottom: "#5E9E32", skin: "#F3C7A5", hair: "#C2572E", style: "beanie" },
  { id: "ace", bgTop: "#9FA8FF", bgBottom: "#4E56C9", skin: "#E8B98A", hair: "#6E3FBF", style: "headphones" },
  { id: "ruby", bgTop: "#FF9B94", bgBottom: "#DE4040", skin: "#FFD9B3", hair: "#4A2C15", style: "bow" },
  { id: "bruno", bgTop: "#FFC46B", bgBottom: "#E08A1E", skin: "#E8B98A", hair: "#3D2A1A", style: "beard" },
  { id: "kito", bgTop: "#A9C4D8", bgBottom: "#5B7B94", skin: "#F5B78D", hair: "#E88A3C", style: "cat" },
  // The gem tier (0018 seed) — same drawn styles, premium palettes.
  { id: "nova", bgTop: "#B9A6FF", bgBottom: "#6E5BD6", skin: "#F3C7A5", hair: "#EDE7FF", style: "spiky" },
  { id: "onyx", bgTop: "#3A3F4A", bgBottom: "#16181D", skin: "#C68642", hair: "#0B0C0F", style: "cap" },
];

export const DEFAULT_AVATAR = AVATARS[0]!;

/** Profiles saved before the cartoon set map to a stable face, not the default. */
const LEGACY_IDS: Record<string, string> = {
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

export function avatarById(id: string | null | undefined): AvatarSpec {
  const mapped = id ? LEGACY_IDS[id] ?? id : null;
  return AVATARS.find((a) => a.id === mapped) ?? DEFAULT_AVATAR;
}
