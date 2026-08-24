/**
 * Which ways into gems are live, and whether any of them are.
 *
 * The Gems tab offers packs and a rewarded ad. Either can be switched off on
 * its own, so "is there any way in at all" is a real question. Pure, so the
 * combinations can be tested without an ad SDK or a store.
 *
 * The rule it exists to hold: never draw a "Get gems" heading over nothing.
 */

export type GemWaysView = {
  /** Any way in is live — draw the "Get gems" heading. */
  visible: boolean;
  /** Draw the pack rows. */
  showPacks: boolean;
  /** Draw the watch-an-ad row. */
  showAd: boolean;
};

export function gemWaysView(opts: {
  /** gems.enabled — the whole premium tier. Off means the currency does not
   *  exist for this player, whatever the sub-placements say. */
  tierOn: boolean;
  /** Any pack is actually purchasable (see gemPriceView). */
  packsBuyable: boolean;
  /** The rewarded-ad row is showable (see gemAdRowView). */
  adVisible: boolean;
}): GemWaysView {
  const { tierOn, packsBuyable, adVisible } = opts;

  const showPacks = tierOn && packsBuyable;
  const showAd = tierOn && adVisible;

  return { visible: showPacks || showAd, showPacks, showAd };
}

/** Which of GemHoard's three tiers a pack earns. */
export type HoardTier = "small" | "medium" | "large";

/**
 * Chosen by position in the lineup, never by gem count.
 *
 * The packs come from server config and their sizes move — 0051 has already
 * moved the economy around them once — so keying the art to "750 means chest"
 * would quietly mismatch the moment someone retunes a pack. Cheapest gets the
 * loose stones, dearest gets the chest, everything between gets the heap.
 */
export function hoardTierFor(index: number, total: number): HoardTier {
  if (total <= 1 || index >= total - 1) return "large";
  if (index === 0) return "small";
  return "medium";
}
