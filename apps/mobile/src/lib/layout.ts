/**
 * Responsive size tiers. Pure and dependency-light (no react-native import) so
 * the Node test suite can exercise the thresholds directly — the RN hook that
 * feeds these live dimensions lives in useLayout.ts.
 *
 * The tier keys off the SHORTER screen dimension, not width: an iPad in a
 * narrow split-view pane reports a small width and should behave like a phone,
 * and the tier must be the same in portrait or landscape.
 */

import { space } from "../theme";

export type LayoutTier = "phone" | "tablet";

/** Point below which the shorter side still reads as a phone. iPad's shortest
 *  side is 744–1024pt; a phone's is ≤430; 700 sits cleanly between, and a
 *  slid-over iPad pane (narrow) correctly falls back to phone. */
export const TABLET_MIN_SHORT_SIDE = 700;

export function layoutTier(width: number, height: number): LayoutTier {
  return Math.min(width, height) >= TABLET_MIN_SHORT_SIDE ? "tablet" : "phone";
}

/** Cap for centered page/sheet content. Phone is uncapped (undefined = a true
 *  no-op in RN styles, so phone layout is byte-identical); tablet clamps to a
 *  comfortable reading column instead of stretching edge to edge. */
export function contentMaxWidth(tier: LayoutTier): number | undefined {
  return tier === "tablet" ? 600 : undefined;
}

/** Multiplier for art and display type on larger screens. 1 on phone leaves
 *  every scaled constant exactly as it is today. */
export function uiScale(tier: LayoutTier): number {
  return tier === "tablet" ? 1.3 : 1;
}

/** Horizontal page padding by tier. */
export function contentPadding(tier: LayoutTier): number {
  return tier === "tablet" ? space.xl : space.lg;
}

/**
 * How the game screen arranges itself. Stacked is the portrait tower we have
 * always shipped: chip row, board, chip row, message, buttons. Railed is the
 * landscape answer — the board keeps the whole height, the four chips flank it
 * in two columns, and the die and action buttons move to a side rail.
 *
 * Stacking the chip rows in landscape is what forces this: two rows cost ~184pt
 * of the axis that is already scarce, which on a rotated phone leaves a board
 * barely half the size of the portrait one. Flanking spends width instead,
 * which landscape has to spare, and lands within a few points of portrait.
 */
export type GameShape = "stacked" | "railed";

export function gameShape(width: number, height: number): GameShape {
  return width > height ? "railed" : "stacked";
}

/** PlayerChip's width, and so the width of one flanking column in the railed
 *  layout. Lives here rather than in PlayerChip because railedBoardSize has to
 *  budget for it — if the two drifted, the board would be mis-sized. */
export const CHIP_COLUMN = 92;

/** Narrowest rail that still fits the die and a row of three 44pt buttons. */
export const GAME_RAIL_MIN = 176;

/** Cap for the game screen's own column. Portrait shares the app-wide reading
 *  column; landscape needs real width for board + chips + rail, so it takes the
 *  window (bounded so a desktop-class freeform window doesn't sprawl — 1400
 *  clears every iPad and foldable in landscape and only catches the genuinely
 *  huge ChromeOS / desktop ones). */
export const GAME_COLUMN_MAX = 1400;

export function gameColumnWidth(shape: GameShape, tier: LayoutTier, width: number): number {
  if (shape === "railed") return Math.min(width, GAME_COLUMN_MAX);
  return contentMaxWidth(tier) ?? width;
}

/** Portrait: the board is capped by the column's width and by the slice of
 *  window height left once the chip rows, message and buttons take theirs.
 *  Unchanged from the portrait-only build — same numbers, same board. */
export function stackedBoardSize(columnWidth: number, height: number, tier: LayoutTier): number {
  return Math.floor(Math.min(columnWidth - space.xl * 2, height * (tier === "tablet" ? 0.5 : 0.44)));
}

/** Landscape: height is the scarce axis, so the caps flip. The board takes the
 *  free height it is given, bounded by the width left over after the page
 *  padding, the two chip columns and the rail.
 *
 *  Both sizers take the column width *before* its horizontal padding, so the
 *  two agree on what `columnWidth` means. */
export function railedBoardSize(columnWidth: number, freeHeight: number): number {
  const widthForBoard = columnWidth - space.xl * 2 - CHIP_COLUMN * 2 - GAME_RAIL_MIN - space.md * 3;
  return Math.max(0, Math.floor(Math.min(widthForBoard, freeHeight)));
}

/**
 * The home hub's vertical budget.
 *
 * Home is a fixed tower — header, chest, still-life, PLAY, mode tiles, dock —
 * and it used to be laid out at one hard-coded size with a ScrollView behind it
 * as the escape hatch. That hatch fired on every short phone: the tower simply
 * did not fit, so the dock slid under the fold and the hub stopped being a hub.
 *
 * Instead, budget it. The furniture is elastic and the still-life takes what is
 * left, so the whole thing lands inside the window on any screen. Degradation
 * has a deliberate order: full size first, then the friends-online line (the
 * one row carrying no tap target), then a single compression factor across the
 * rest — floored per piece so nothing shrinks below a comfortable touch target.
 * A tall screen runs the same machinery in reverse, growing the furniture a
 * little rather than stranding acres of felt around a floating board.
 */

/** Natural (uncompressed) heights, in points, before the tier's uiScale. */
export const HOME_NATURAL = {
  /** Wallet pills / profile chip row — a tap target, so never compressed. */
  header: 44,
  headerPad: 12,
  chest: 48,
  /** PLAY, including its 4pt under-edge. */
  cta: 64,
  presence: 18,
  tile: 96,
  dock: 64,
  gap: 8,
} as const;

/** Per-piece floors. Interactive rows stay at/above a comfortable target. */
const HOME_FLOOR = {
  headerPad: 6,
  chest: 34,
  cta: 48,
  tile: 62,
  dock: 46,
  gap: 4,
} as const;

/** Below this the still-life reads as a stamp, not a diorama. */
export const HERO_MIN = 150;

/** Past this the board is just floating in felt; spend the rest on furniture. */
export const HERO_MAX = 360;

/** How far the furniture may compress (short phone) or grow (tall phone). */
const K_MIN = 0.6;
const K_MAX = 1.12;

export interface HomeMetrics {
  headerPad: number;
  chest: number;
  cta: number;
  /** 0 when the line has been dropped to buy the still-life its floor. */
  presence: number;
  tile: number;
  dock: number;
  gap: number;
  /** What is left for the still-life once the furniture has taken its share. */
  hero: number;
}

/**
 * @param available height of the hub column: the window minus safe-area insets
 *   and minus the anchored ad strip (measure it — don't estimate the ad away).
 * @param scale the tier's uiScale.
 */
export function homeMetrics(available: number, scale = 1): HomeMetrics {
  const nat = {
    header: HOME_NATURAL.header,
    headerPad: HOME_NATURAL.headerPad * scale,
    chest: HOME_NATURAL.chest * scale,
    cta: HOME_NATURAL.cta * scale,
    presence: HOME_NATURAL.presence * scale,
    tile: HOME_NATURAL.tile * scale,
    dock: HOME_NATURAL.dock * scale,
    gap: HOME_NATURAL.gap * scale,
  };
  const heroMin = HERO_MIN * scale;

  // Gaps in the tower: hero's top pad, chest→hero, hero→PLAY, PLAY→presence,
  // tiles' top pad, dock's top and bottom pads.
  const gaps = (withPresence: boolean) => (withPresence ? 7 : 6);
  const sum = (k: number, presence: number) =>
    nat.header +
    Math.max(HOME_FLOOR.headerPad, nat.headerPad * k) +
    gaps(presence > 0) * Math.max(HOME_FLOOR.gap, nat.gap * k) +
    Math.max(HOME_FLOOR.chest, nat.chest * k) +
    Math.max(HOME_FLOOR.cta, nat.cta * k) +
    presence +
    Math.max(HOME_FLOOR.tile, nat.tile * k) +
    Math.max(HOME_FLOOR.dock, nat.dock * k);

  // Unmeasured (first frame): natural size, corrected on the layout pass.
  const room = Number.isFinite(available) && available > 0 ? available : sum(1, nat.presence) + heroMin;

  let presence = nat.presence;
  let k = 1;
  const slack = room - sum(1, presence);
  if (slack < heroMin) {
    // 1. The friends line goes first — it is the only row with nothing to tap.
    presence = 0;
    if (room - sum(1, presence) < heroMin) {
      // 2. Compress the rest. The header row is excluded: 44pt is a floor, not
      //    a preference. Solved against the uncompressed springy total, then
      //    re-summed, because the per-piece floors bend the result upward.
      const springy = sum(1, presence) - nat.header;
      k = Math.min(1, Math.max(K_MIN, (room - heroMin - nat.header) / springy));
    }
  } else if (slack > HERO_MAX * scale) {
    // 3. Room to spare: grow the furniture rather than the felt.
    const springy = sum(1, presence) - nat.header;
    k = Math.min(K_MAX, 1 + (slack - HERO_MAX * scale) / springy);
  }

  const m: HomeMetrics = {
    headerPad: Math.round(Math.max(HOME_FLOOR.headerPad, nat.headerPad * k)),
    chest: Math.round(Math.max(HOME_FLOOR.chest, nat.chest * k)),
    cta: Math.round(Math.max(HOME_FLOOR.cta, nat.cta * k)),
    presence: Math.round(presence),
    tile: Math.round(Math.max(HOME_FLOOR.tile, nat.tile * k)),
    dock: Math.round(Math.max(HOME_FLOOR.dock, nat.dock * k)),
    gap: Math.round(Math.max(HOME_FLOOR.gap, nat.gap * k)),
    hero: 0,
  };
  m.hero = Math.max(0, Math.round(room - homeFurniture(m)));
  return m;
}

/** Everything in the tower except the still-life — what `hero` is the rest of. */
export function homeFurniture(m: HomeMetrics): number {
  const gaps = m.presence > 0 ? 7 : 6;
  return (
    HOME_NATURAL.header + m.headerPad + gaps * m.gap + m.chest + m.cta + m.presence + m.tile + m.dock
  );
}
