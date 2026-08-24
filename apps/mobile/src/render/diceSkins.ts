/**
 * Purchasable dice skins — a per-player cosmetic worn on the profile (see
 * profileStore.diceSkinId / profiles.dice_skin) and shown to every player at
 * the table when its owner rolls, not just its owner. "classic" is the only
 * skin without its own face/pip colors: it inherits the viewer's board theme
 * (render/boardThemes.ts), exactly matching the die's pre-cosmetics look, so
 * a player who never buys anything sees no change at all.
 *
 * Every field here is purely visual, by the same rule the catalog migration
 * states for the coin-shop schema: if a skin ever needs a gameplay property,
 * that's a design smell, not a schema change (guarded mechanically by
 * __tests__/diceSkins.test.ts's key-allowlist check).
 *
 * Prices mirror supabase/migrations/0014_dice_skins.sql — keep them in sync;
 * a test parses that file and cross-checks every id/price pair both ways.
 */

import type { BoardTheme } from "./boardThemes";
import type { MotifKind } from "./faceMotifs";
import type { FaceMark, OverlayKind } from "./pipShapes";

export type DiceSkinId =
  | "classic"
  | "cherry"
  | "mint"
  | "midnight"
  | "bubblegum"
  | "walnut"
  | "marble"
  | "neon"
  | "gold"
  | "galaxy"
  | "ember"
  | "diamond"
  | "obsidian-king"
  | "prism"
  | "ivory"
  | "jade"
  | "oxblood"
  | "bullion"
  | "bloom"
  | "lapis"
  | "sovereign";

export type DiceFaceSpec =
  | null // the default die (classic only) — see DEFAULT_DIE
  | { type: "solid"; color: string }
  | { type: "linear"; colors: string[]; stops?: number[] };

export type DicePipSpec =
  | null // the default die, dot shape (classic only)
  | { color: string; shape: FaceMark; glow?: string };

/**
 * What "classic" actually looks like: the original pre-cosmetics die.
 *
 * This used to be resolved from the VIEWER's board theme, which made a die's
 * appearance depend on who was looking at it. On a Walnut board, every
 * opponent who had never bought a skin appeared to be rolling a Walnut die —
 * so the one thing a skin is for, being recognisably yours, broke for the
 * default. A die belongs to its owner, not to the table it lands on, so the
 * default is now a constant like every other skin.
 *
 * Same literals as BOARD_THEMES.classic.dice, which is what the die looked
 * like before themes existed.
 */
export const DEFAULT_DIE = { face: "#FFFFFF", pip: "#17181C" } as const;

export interface DiceSkin {
  id: DiceSkinId;
  label: string;
  /** Cost to unlock; 0 = free. Must match the seeded `dice.<id>` catalog row. */
  price: number;
  /** Which wallet the price charges. Omitted = coins (the default tier). */
  currency?: "gems";
  face: DiceFaceSpec;
  pip: DicePipSpec;
  /** Tumble core / landed under-layer. Omitted = derive from the face (today's look). */
  edge?: string;
  /** Rim stroke on the landed face — reserved for the top prestige tier. */
  frame?: string;
  /** A cheap deterministic decorative pass over the landed face. */
  overlay?: OverlayKind;
  /**
   * Polished-finish strength, 0..1. Omitted = matte.
   *
   * A gloss sweep across the face and a lit edge along the top of the mark —
   * the difference between a color printed on a cube and a surface with
   * something over it. It is the tier's tell: gems are the wallet you reach
   * for with money rather than play time, so a gem-priced die is lacquered
   * and a coin-priced one is not, and you can see which is which across the
   * table without reading a label. Purely a finish; it says nothing about the
   * roll (see the header).
   */
  sheen?: number;
  /**
   * Ornament struck into the face, behind the numeral — a petal rosette,
   * engine-turned guilloché, a Deco sunburst (render/faceMotifs.ts).
   *
   * Distinct from `overlay`, which is a texture saying what the face is MADE
   * of. A motif is a figure saying the face was DECORATED, and it is what
   * separates the top of the tier from a well-chosen color: material alone
   * runs out of ways to look more expensive, ornament does not.
   *
   * `scale` is the ornament's radius as a fraction of the die's width (so
   * 0.44 very nearly fills the face); `alpha` keeps it behind the numeral
   * rather than competing with it.
   */
  motif?: { kind: MotifKind; color: string; alpha: number; scale: number };
}

// Declared cheap → prestige; __tests__/diceSkins.test.ts asserts this order
// matches ascending price.
export const DICE_SKINS: Record<DiceSkinId, DiceSkin> = {
  classic: {
    id: "classic",
    label: "Classic",
    price: 0,
    face: null,
    pip: null,
  },
  cherry: {
    id: "cherry",
    label: "Cherry",
    price: 400,
    face: { type: "solid", color: "#D8443C" },
    pip: { color: "#FFF7F2", shape: "dot" },
    edge: "#A32C26",
  },
  mint: {
    id: "mint",
    label: "Mint",
    price: 400,
    face: { type: "solid", color: "#6FD3AE" },
    pip: { color: "#0F4636", shape: "dot" },
    edge: "#46A583",
  },
  midnight: {
    id: "midnight",
    label: "Midnight",
    price: 600,
    face: { type: "solid", color: "#1E2430" },
    pip: { color: "#6FE3FF", shape: "dot" },
    edge: "#10141C",
  },
  bubblegum: {
    id: "bubblegum",
    label: "Bubblegum",
    price: 800,
    face: { type: "linear", colors: ["#FF9AC4", "#F26BA4"] },
    pip: { color: "#FFFFFF", shape: "heart" },
    edge: "#C94E85",
  },
  walnut: {
    id: "walnut",
    label: "Walnut Wood",
    price: 1500,
    face: { type: "linear", colors: ["#9A6B3F", "#6B4526"] },
    pip: { color: "#F3E9D7", shape: "dot" },
    edge: "#4A2E17",
    overlay: "grain",
  },
  marble: {
    id: "marble",
    label: "Marble",
    price: 2000,
    face: { type: "linear", colors: ["#F7F5F0", "#B7B5C2"] },
    pip: { color: "#2A2C33", shape: "dot" },
    edge: "#8E8C99",
    overlay: "veins",
  },
  neon: {
    id: "neon",
    label: "Neon Pulse",
    price: 2500,
    face: { type: "solid", color: "#14161C" },
    pip: { color: "#39FF88", shape: "dot", glow: "#39FF88" },
    edge: "#05070B",
  },
  gold: {
    id: "gold",
    label: "Royal Gold",
    price: 8000,
    face: { type: "linear", colors: ["#F6D97C", "#D4A83B", "#B8862B"], stops: [0, 0.55, 1] },
    pip: { color: "#5C3A12", shape: "crown" },
    edge: "#8A6420",
    frame: "#FFF0BE",
  },
  galaxy: {
    id: "galaxy",
    label: "Galaxy",
    price: 10000,
    face: { type: "linear", colors: ["#2B2560", "#4B2E83", "#121233"] },
    pip: { color: "#E8E6FF", shape: "star", glow: "#8F7BFF" },
    edge: "#0B0B22",
    overlay: "stars",
  },
  ember: {
    id: "ember",
    label: "Dragon Ember",
    price: 12000,
    face: { type: "linear", colors: ["#2B2320", "#6E1F14", "#A93415"], stops: [0, 0.6, 1] },
    pip: { color: "#FF9E3D", shape: "flame", glow: "#FF5A26" },
    edge: "#1A120E",
  },
  diamond: {
    id: "diamond",
    label: "Diamond",
    price: 40000,
    face: { type: "linear", colors: ["#F0F8FF", "#BADDF5", "#5FA8DE"] },
    pip: { color: "#1E5C8C", shape: "diamond", glow: "#FFFFFF" },
    edge: "#3D7FB3",
    overlay: "facets",
  },
  "obsidian-king": {
    id: "obsidian-king",
    label: "Obsidian King",
    price: 75000,
    face: { type: "linear", colors: ["#16161A", "#000000"] },
    pip: { color: "#F2D272", shape: "crown", glow: "#FFDF8E" },
    edge: "#000000",
    frame: "#E9C464",
    overlay: "facets",
  },
  // The gem tier (0018 seed). Declared after the coin ladder — the ascending-
  // price check applies to coin skins only; gem prices are a separate scale.
  // ---------------------------------------------------------------------
  // The Numerals line (0044 seed). Four gem-priced skins that ink a single
  // figure on each face instead of a pip cluster — shape: "numeral", drawn by
  // render/dieNumerals.ts. Purely a change of marking: a 4 is still a 4, and
  // nothing here touches the roll (see the header's cosmetic-only rule).
  //
  // Deliberately one light, two jewel tones and one dark flagship, so no two
  // read alike across a board, and none reads as the free classic white die
  // at a glance. All four stay well under the "premium" trap of a neon or
  // fully-saturated face — the tier sells material, not brightness.
  // ---------------------------------------------------------------------
  prism: {
    id: "prism",
    label: "Prism",
    price: 150,
    currency: "gems",
    face: { type: "linear", colors: ["#B9A6FF", "#7BD7E8", "#F6A6D2"], stops: [0, 0.5, 1] },
    pip: { color: "#FFFFFF", shape: "diamond", glow: "#C9C2FF" },
    edge: "#6E5BD6",
    frame: "#E8E2FF",
    overlay: "facets",
    sheen: 0.5,
  },
  ivory: {
    id: "ivory",
    label: "Ivory Atelier",
    price: 180,
    currency: "gems",
    face: { type: "linear", colors: ["#FBF7EF", "#E7DAC3"] },
    pip: { color: "#2A231B", shape: "numeral" },
    edge: "#C4B49A",
    frame: "#C6A664",
    overlay: "grain", // the tooth of pressed ivory, not wood
    sheen: 0.3,
  },
  jade: {
    id: "jade",
    label: "Imperial Jade",
    price: 260,
    currency: "gems",
    face: { type: "linear", colors: ["#356254", "#16302A"] },
    pip: { color: "#EFE7D2", shape: "numeral" },
    edge: "#0E2019",
    overlay: "veins", // pale mineral veining, which is what makes it stone
    sheen: 0.45,
  },
  oxblood: {
    id: "oxblood",
    label: "Oxblood Lacquer",
    price: 320,
    currency: "gems",
    face: { type: "linear", colors: ["#5E1F26", "#331016"] },
    pip: { color: "#EBB98E", shape: "numeral" },
    edge: "#1E0A0E",
    frame: "#C98B5E",
    // No overlay on purpose: lacquer is a flawless surface. Texturing it
    // would read as a scratch, not as a finish.
    sheen: 0.6,
  },
  bullion: {
    id: "bullion",
    label: "Bullion",
    price: 420,
    currency: "gems",
    face: { type: "linear", colors: ["#24252C", "#101116"] },
    pip: { color: "#E8C77A", shape: "numeral", glow: "#F2D89A" },
    edge: "#0C0D11",
    frame: "#C9A227",
    overlay: "grain", // brushed striations, in the numeral's own gold
    sheen: 0.55,
  },
  // The ornamented top of the line. Material alone runs out of ways to look
  // more expensive somewhere around a polished lacquer, so these three carry a
  // struck figure as well as a finish — a bloom, a sunburst, engine turning.
  bloom: {
    id: "bloom",
    label: "Cloisonné Bloom",
    price: 460,
    currency: "gems",
    face: { type: "linear", colors: ["#1F5A57", "#0C2B2C"] },
    pip: { color: "#F6EDD8", shape: "numeral" },
    edge: "#08191A",
    frame: "#E0BC79",
    sheen: 0.5,
    motif: { kind: "rosette", color: "#EBC886", alpha: 0.66, scale: 0.42 },
  },
  lapis: {
    id: "lapis",
    label: "Lapis Deco",
    price: 520,
    currency: "gems",
    face: { type: "linear", colors: ["#2E52A0", "#111F45"] },
    pip: { color: "#F7E3AC", shape: "numeral" },
    edge: "#0A1128",
    frame: "#D4AC33",
    sheen: 0.5,
    motif: { kind: "deco", color: "#F0D08A", alpha: 0.78, scale: 0.46 },
  },
  sovereign: {
    id: "sovereign",
    label: "Sovereign",
    price: 600,
    currency: "gems",
    face: { type: "linear", colors: ["#F7E6AC", "#D8AE45", "#9C6E22"], stops: [0, 0.55, 1] },
    pip: { color: "#422E0C", shape: "numeral" },
    edge: "#6E4E16",
    frame: "#FCF2CE",
    sheen: 0.6,
    // Cut lines rather than inlay: the ornament is the same metal as the face,
    // which is exactly what engine turning is.
    motif: { kind: "guilloche", color: "#7E5A1E", alpha: 0.45, scale: 0.44 },
  },
};

export const DEFAULT_DICE_SKIN = DICE_SKINS.classic;

const DICE_SKIN_LIST = Object.values(DICE_SKINS);

/** Unknown/missing ids (a stale client, a not-yet-seeded skin, or a bogus
 *  network value) always resolve to classic rather than throwing — cosmetics
 *  must never be able to break a render. Looked up by value over the list
 *  (not a bracket index into DICE_SKINS) so a wire value like "__proto__" or
 *  "constructor" can't resolve to anything but classic. */
export function resolveDiceSkin(id: string | null | undefined): DiceSkin {
  if (!id) return DEFAULT_DICE_SKIN;
  return DICE_SKIN_LIST.find((s) => s.id === id) ?? DEFAULT_DICE_SKIN;
}

/** "#RRGGBB" → [r, g, b] for the worklet color mixer (moved from Dice.tsx so
 *  the skin→color mapping is unit-testable without importing Skia). */
export function hexRGB(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Plain-data render inputs for Dice.tsx — everything the picture worklet
 *  needs, pre-resolved on the JS thread so only serializable values cross
 *  into the worklet closure (see Dice.tsx's single `sp` memo). */
export interface DiceRenderParams {
  faceRGB: [number, number, number];
  pipRGB: [number, number, number];
  gradient: { colors: string[]; stops: number[] | null } | null;
  pipShape: FaceMark;
  glow: string | null;
  edgeRGB: [number, number, number] | null;
  frame: string | null;
  overlay: OverlayKind | null;
  /** Polished-finish strength, 0 when the skin is matte. */
  sheen: number;
  /** Face ornament, or null when the skin carries none. */
  motif: { kind: MotifKind; color: string; alpha: number; scale: number } | null;
  /** Stable per-skin seed for the deterministic overlay pass — independent of
   *  the viewer's board theme, so the same skin always textures the same way. */
  overlaySeed: number;
}

/** FNV-1a string hash — deterministic, tiny, no collisions that matter for a
 *  catalog this size, used only to seed a decorative pattern. */
function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Resolves a skin (classic's nulls included) against the viewer's board
 *  theme into plain render data. `skin` undefined behaves exactly like
 *  classic with no theme — the original Dice.tsx literals. */
export function diceRenderParams(skin: DiceSkin | undefined, _theme?: BoardTheme): DiceRenderParams {
  const face = skin?.face ?? null;
  const pip = skin?.pip ?? null;
  const faceHex = face ? (face.type === "solid" ? face.color : face.colors[0]!) : DEFAULT_DIE.face;
  const pipHex = pip ? pip.color : DEFAULT_DIE.pip;
  return {
    faceRGB: hexRGB(faceHex),
    pipRGB: hexRGB(pipHex),
    gradient: face?.type === "linear" ? { colors: face.colors, stops: face.stops ?? null } : null,
    pipShape: pip?.shape ?? "dot",
    glow: pip?.glow ?? null,
    edgeRGB: skin?.edge ? hexRGB(skin.edge) : null,
    frame: skin?.frame ?? null,
    overlay: skin?.overlay ?? null,
    sheen: skin?.sheen ?? 0,
    motif: skin?.motif ?? null,
    overlaySeed: skin ? hashSeed(skin.id) : 0,
  };
}
