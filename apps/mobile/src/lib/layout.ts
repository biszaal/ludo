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
