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
