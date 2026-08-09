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
import type { OverlayKind, PipShape } from "./pipShapes";

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
  | "prism";

export type DiceFaceSpec =
  | null // the default die (classic only) — see DEFAULT_DIE
  | { type: "solid"; color: string }
  | { type: "linear"; colors: string[]; stops?: number[] };

export type DicePipSpec =
  | null // the default die, dot shape (classic only)
  | { color: string; shape: PipShape; glow?: string };

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
  pipShape: PipShape;
  glow: string | null;
  edgeRGB: [number, number, number] | null;
  frame: string | null;
  overlay: OverlayKind | null;
  /** Stable per-skin seed for the deterministic overlay pass — independent of
   *  the viewer's board theme, so the same skin always textures the same way. */
  overlaySeed: number;
}

/** FNV-1a string hash — deterministic, tiny, no collisions that matter for a
 *  13-entry catalog used only to seed a decorative pattern. */
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
    overlaySeed: skin ? hashSeed(skin.id) : 0,
  };
}
