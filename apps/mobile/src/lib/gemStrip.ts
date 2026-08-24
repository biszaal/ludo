/**
 * Whether the Shop's gem strip is worth drawing, and which halves of it are.
 *
 * The strip is a promotion surface, not a checkout: it shows the packs and the
 * rewarded ad, and hands the actual buying to the Gems sheet (which owns the
 * purchase state and is reachable from Home and the browser too). Pure, so the
 * combinations can be tested without an ad SDK or a store.
 *
 * The rule it exists to hold: never draw a "Get gems" heading over nothing.
 * Each way in can be switched off on its own — `purchasesEnabled` is the
 * billing flag, the ad has its own placement kill switch — so "some way in is
 * live" is a real question rather than an obvious one.
 */

export type GemStripView = {
  /** Draw the strip at all. */
  visible: boolean;
  /** Draw the pack chips. */
  showPacks: boolean;
  /** Draw the watch-an-ad chip. */
  showAd: boolean;
};

export function gemStripView(opts: {
  /** gems.enabled — the whole premium tier. Off means the currency does not
   *  exist for this player, whatever the sub-placements say. */
  tierOn: boolean;
  /** Any pack is actually purchasable (see gemPriceView). */
  packsBuyable: boolean;
  /** The rewarded-ad row is showable (see gemAdRowView). */
  adVisible: boolean;
}): GemStripView {
  const { tierOn, packsBuyable, adVisible } = opts;

  const showPacks = tierOn && packsBuyable;
  const showAd = tierOn && adVisible;

  return { visible: showPacks || showAd, showPacks, showAd };
}
