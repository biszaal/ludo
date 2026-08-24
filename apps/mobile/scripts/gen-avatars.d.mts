/** Types for gen-avatars.mjs, so the Node test suite can import the art catalog. */

export type ChipTone = "pearl" | "slate" | "lilac" | "violet" | "orchid";

export interface AvatarArtSpec {
  id: string;
  skin: string;
  hair: string;
  shirt: string;
  style: string;
  tone: ChipTone;
}

/** One flat fill per tone — the chip has no gradient and no pattern. */
export const CHIP_TONES: Record<ChipTone, string>;
export const AVATARS: AvatarArtSpec[];
export const OUT_DIR: string;

export function saturationOf(hex: string): number;
export function hslOf(hex: string): { h: number; s: number; l: number };
export function contrastRatio(a: string, b: string): number;
export function parseColor(c: string): [number, number, number, number];
export function parsePath(d: string): [number, number][][];
export function renderAvatar(spec: AvatarArtSpec, size?: number): Buffer;
export function encodePNG(size: number, rgba: Buffer): Buffer;
