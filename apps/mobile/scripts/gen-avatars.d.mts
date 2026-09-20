/** Types for gen-avatars.mjs, so the Node test suite can import the art catalog. */

export type ChipTone = "pearl" | "slate" | "lilac" | "violet" | "orchid";

export interface AvatarArtSpec {
  id: string;
  /** Display name and one-line character tag, for design reference. */
  name: string;
  tag: string;
  /** The chip this character sits on. */
  tone: ChipTone;
  /** The colour of the outermost shape where it meets the chip. */
  edge: string;
  /** An outline on that shape, for a silhouette paler than the chip can tell. */
  rim?: string;

  /** A SKIN key or a literal hex, for characters who are not human. */
  skin: string;
  /** The torso; muted below every seat colour. */
  bust: string;

  face?: string;
  eyes?: string;
  brow?: string;
  mouth?: string;
  eyeOpts?: { ink?: string; glow?: string; y?: number; dx?: number };
  browOpts?: { y?: number; dx?: number; w?: number };
  mouthOpts?: { y?: number; ink?: string; lip?: string; bot?: string };
  browColor?: string;
  blush?: string;
  noseY?: number;
  noEars?: boolean;
  noNose?: boolean;

  /** A key into the hair library, with its colour. */
  hair?: string;
  hairColor?: string;
  /** A key into the headgear library, with up to two colours. */
  hat?: string;
  hatColor?: string;
  hatColor2?: string;

  /** A whole body preserved from v1, in its own 100-unit space. Bypasses the
   *  feature libraries entirely — see Onyx. */
  legacy?: string;

  /** Raw SVG drawn behind the head, in front of everything, and on the bust. */
  back?: string;
  front?: string;
  collar?: string;
  faceMark?: string;
}

/** A flattened subpath: points in design space, and whether it closes. */
export interface SubPath {
  pts: [number, number][];
  closed: boolean;
}

/** One draw operation — a fill or a stroke over already-flattened geometry. */
export interface DrawOp {
  polys: SubPath[];
  opacity: number;
  fill?: string;
  stroke?: string;
  width?: number;
  cap?: string;
  dash?: number[] | null;
}

/** One flat fill per tone — the chip has no gradient and no pattern. */
export const CHIP_TONES: Record<ChipTone, string>;
export const AVATARS: AvatarArtSpec[];
export const OUT_DIR: string;

export function saturationOf(hex: string): number;
export function hslOf(hex: string): { h: number; s: number; l: number };
export function contrastRatio(a: string, b: string): number;
export function parseColor(c: string): [number, number, number, number];
export function parsePath(d: string): SubPath[];
export function buildSVG(spec: AvatarArtSpec): string;
export function svgToOps(svg: string): DrawOp[];
export function renderSVG(svg: string, size?: number): Buffer;
export function renderAvatar(spec: AvatarArtSpec, size?: number): Buffer;
export function encodePNG(size: number, rgba: Buffer): Buffer;
