/** Types for gen-avatars.mjs, so the Node test suite can import the art catalog. */

export type ChipTone = "stone" | "ash";

export interface AvatarArtSpec {
  id: string;
  skin: string;
  hair: string;
  shirt: string;
  style: string;
  tone: ChipTone;
  pattern: string;
}

/** A single drawing instruction; `fill` for shapes, `color` for strokes/rings. */
export interface ChipOp {
  t: "path" | "circle" | "ring";
  fill?: string;
  color?: string;
}

export const CHIP_TONES: Record<ChipTone, { readonly top: string; readonly bottom: string }>;
export const PATTERNS: string[];
export function chipOps(spec: AvatarArtSpec): ChipOp[];
export const AVATARS: AvatarArtSpec[];
export const OUT_DIR: string;

export function saturationOf(hex: string): number;
export function contrastRatio(a: string, b: string): number;
export function parseColor(c: string): [number, number, number, number];
export function parsePath(d: string): [number, number][][];
export function renderAvatar(spec: AvatarArtSpec, size?: number): Buffer;
export function encodePNG(size: number, rgba: Buffer): Buffer;
